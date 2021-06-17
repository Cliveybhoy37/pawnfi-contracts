import { expect } from "chai";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, BigNumberish } from "ethers";
import { deploy } from "./utils/contracts";

import { OriginationController, MockERC20, AssetWrapper, PromissoryNote, MockLoanCore } from "../typechain";
import { approve, mint, ZERO_ADDRESS } from "./utils/erc20";
import { fromRpcSig } from "ethereumjs-util";

type Signer = SignerWithAddress;

interface TestContext {
  originationController: OriginationController;
  mockERC20: MockERC20;
  assetWrapper: AssetWrapper;
  lenderPromissoryNote: PromissoryNote;
  borrowerPromissoryNote: PromissoryNote;
  loanCore: MockLoanCore;
  user: Signer;
  other: Signer;
  signers: Signer[];
}

interface LoanTerms {
  dueDate: BigNumberish;
  principal: BigNumber;
  interest: BigNumber;
  collateralTokenId: BigNumber;
  payableCurrency: string;
}

const typedData = {
  types: {
    LoanTerms: [
      { name: "dueDate", type: "uint256" },
      { name: "principal", type: "uint256" },
      { name: "interest", type: "uint256" },
      { name: "collateralTokenId", type: "uint256" },
      { name: "payableCurrency", type: "address" },
    ],
  },
  primaryType: "LoanTerms" as const,
};

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const chainId = hre.network.config.chainId!;

const initializeBundle = async (AssetWrapper: AssetWrapper, user: Signer): Promise<BigNumber> => {
  const tx = await AssetWrapper.connect(user).initializeBundle(await user.getAddress());
  const receipt = await tx.wait();

  if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
    return receipt.events[0].args.tokenId;
  } else {
    throw new Error("Unable to initialize bundle");
  }
};

const setupTestContext = async (): Promise<TestContext> => {
  const signers: Signer[] = await hre.ethers.getSigners();
  const loanCore = <MockLoanCore>await deploy("MockLoanCore", signers[0], []);
  const assetWrapper = <AssetWrapper>await deploy("AssetWrapper", signers[0], ["AssetWrapper", "WRP"]);
  const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);

  const originationController = <OriginationController>(
    await deploy("OriginationController", signers[0], [loanCore.address, assetWrapper.address])
  );

  const borrowerNoteAddress = await loanCore.borrowerNote();
  const lenderNoteAddress = await loanCore.lenderNote();

  const noteFactory = await hre.ethers.getContractFactory("PromissoryNote");
  const borrowerPromissoryNote = <PromissoryNote>await noteFactory.attach(borrowerNoteAddress);
  const lenderPromissoryNote = <PromissoryNote>await noteFactory.attach(lenderNoteAddress);

  return {
    originationController,
    mockERC20,
    assetWrapper,
    lenderPromissoryNote,
    borrowerPromissoryNote,
    loanCore,
    user: signers[0],
    other: signers[1],
    signers: signers.slice(2),
  };
};

const createLoanTerms = (
  payableCurrency: string,
  {
    dueDate = new Date(new Date().getTime() + 3600000).getTime(),
    principal = hre.ethers.utils.parseEther("100"),
    interest = hre.ethers.utils.parseEther("1"),
    collateralTokenId = BigNumber.from("1"),
  }: Partial<LoanTerms> = {},
): LoanTerms => {
  return {
    dueDate,
    principal,
    interest,
    collateralTokenId,
    payableCurrency,
  };
};

const buildData = (chainId: number, verifyingContract: string, name: string, version: string, loanTerms: LoanTerms) => {
  return Object.assign({}, typedData, {
    domain: {
      name,
      version,
      chainId,
      verifyingContract,
    },
    message: loanTerms,
  });
};

describe("OriginationController", () => {
  describe("constructor", () => {
    it("Reverts if _loanCore address is not provided", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      const assetWrapper = <AssetWrapper>await deploy("AssetWrapper", signers[0], ["AssetWrapper", "WRP"]);
      await expect(deploy("OriginationController", signers[0], [ZERO_ADDRESS, assetWrapper.address])).to.be.reverted;
    });

    it("Instantiates the OriginationController", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      const loanCore = <MockLoanCore>await deploy("MockLoanCore", signers[0], []);
      const assetWrapper = <AssetWrapper>await deploy("AssetWrapper", signers[0], ["AssetWrapper", "WRP"]);
      expect(deploy("OriginationController", signers[0], [loanCore.address, assetWrapper.address]));
    });
  });

  describe("initializeLoan", () => {
    it("Reverts if msg.sender is not either lender or borrower", async () => {
      const {
        originationController,
        assetWrapper,
        user,
        lenderPromissoryNote,
        borrowerPromissoryNote,
      } = await setupTestContext();
      const loanTerms = createLoanTerms(assetWrapper.address);

      const data = buildData(chainId, assetWrapper.address, await assetWrapper.name(), "1", loanTerms);

      const signature = await user._signTypedData(data.domain, data.types, data.message);
      const { v, r, s } = fromRpcSig(signature);
      await expect(
        originationController
          .connect(ZERO_ADDRESS)
          .initializeLoan(loanTerms, lenderPromissoryNote.address, borrowerPromissoryNote.address, v, r, s),
      ).to.be.reverted;
    });

    it("Reverts if it has not been approved to accept the collateral token by the borrower", async () => {
      const {
        originationController,
        assetWrapper,
        user,
        lenderPromissoryNote,
        borrowerPromissoryNote,
      } = await setupTestContext();
      const loanTerms = createLoanTerms(assetWrapper.address);

      const data = buildData(chainId, assetWrapper.address, await assetWrapper.name(), "1", loanTerms);

      const signature = await user._signTypedData(data.domain, data.types, data.message);
      const { v, r, s } = fromRpcSig(signature);

      await expect(
        originationController
          .connect(user)
          .initializeLoan(loanTerms, lenderPromissoryNote.address, borrowerPromissoryNote.address, v, r, s),
      ).to.be.reverted;
    });
  });

  it("Reverts if it has not been approved to accept the funding currency tokens by the lender", async () => {
    const {
      originationController,
      assetWrapper,
      user,
      other,
      lenderPromissoryNote,
      borrowerPromissoryNote,
    } = await setupTestContext();
    const loanTerms = createLoanTerms(assetWrapper.address);
    const bundleId = await initializeBundle(assetWrapper, user);

    const data = buildData(chainId, assetWrapper.address, await assetWrapper.name(), "1", loanTerms);

    const signature = await user._signTypedData(data.domain, data.types, data.message);
    const { v, r, s } = fromRpcSig(signature);
    await expect(
      originationController
        .connect(ZERO_ADDRESS)
        .initializeLoan(loanTerms, lenderPromissoryNote.address, borrowerPromissoryNote.address, v, r, s),
    ).to.be.reverted;
  });

  it("Reverts if it has not been approved to accept the collateral token by the borrower", async () => {
    const {
      originationController,
      mockERC20,
      assetWrapper,
      user,
      other,
      lenderPromissoryNote,
      borrowerPromissoryNote,
    } = await setupTestContext();
    const loanTerms = createLoanTerms(assetWrapper.address);
    const bundleId = await initializeBundle(assetWrapper, user);

    const data = buildData(chainId, assetWrapper.address, await assetWrapper.name(), "1", loanTerms);

    const signature = await user._signTypedData(data.domain, data.types, data.message);
    const { v, r, s } = fromRpcSig(signature);

    await approve(mockERC20, other, originationController.address, loanTerms.principal);

    await expect(
      originationController
        .connect(user)
        .initializeLoan(loanTerms, lenderPromissoryNote.address, borrowerPromissoryNote.address, v, r, s),
    ).to.be.reverted;
  });

  it("Initializes a loan", async () => {
    const {
      originationController,
      mockERC20,
      loanCore,
      assetWrapper,
      user: lender,
      other: borrower,
      lenderPromissoryNote,
      borrowerPromissoryNote,
    } = await setupTestContext();

    const bundleId = await initializeBundle(assetWrapper, borrower);
    const loanTerms = createLoanTerms(mockERC20.address, { collateralTokenId: bundleId });
    await mint(mockERC20, lender, loanTerms.principal);
    console.log(loanTerms);

    const data = buildData(chainId, originationController.address, "OriginationController", "1", loanTerms);

    const signature = await borrower._signTypedData(data.domain, data.types, data.message);
    const { v, r, s } = fromRpcSig(signature);
    console.log("sig:", signature);
    await approve(mockERC20, lender, originationController.address, loanTerms.principal);
    await assetWrapper.connect(borrower).approve(originationController.address, bundleId);
    console.log("borrower:", await borrower.getAddress());
    console.log("lender:", await lender.getAddress());
    await expect(
      await originationController
        .connect(lender)
        .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), v, r, s),
    )
      .to.emit(mockERC20, "Transfer")
      .withArgs(await lender.getAddress(), loanCore.address, loanTerms.principal);
  });

  describe("initializeLoanWithCollateralPermit", () => {
    it("Reverts if AssetWrapper.permit is invalid", async () => {
      const {
        originationController,
        mockERC20,
        assetWrapper,
        user,
        other,
        lenderPromissoryNote,
        borrowerPromissoryNote,
      } = await setupTestContext();

      const loanTerms = createLoanTerms(assetWrapper.address);
      const bundleId = await initializeBundle(assetWrapper, user);

      const data = buildData(chainId, assetWrapper.address, await assetWrapper.name(), "1", loanTerms);

      const collateralSignature = await user._signTypedData(data.domain, data.types, data.message);
      const { v: collateralV, r: collateralR, s: collateralS } = fromRpcSig(collateralSignature);

      const approvalData = buildData(
        chainId,
        originationController.address,
        "originationController",
        "approvalMessage",
        loanTerms,
      );

      const signature = await user._signTypedData(approvalData.domain, approvalData.types, approvalData.message);

      const { v, r, s } = fromRpcSig(signature);

      expect(
        originationController
          .connect(user)
          .initializeLoanWithCollateralPermit(
            loanTerms,
            lenderPromissoryNote.address,
            borrowerPromissoryNote.address,
            collateralV,
            collateralR,
            collateralS,
            v,
            r,
            s,
          ),
      ).to.be.reverted;
    });

    it("Initializes a loan with permit", async () => {
      const {
        originationController,
        mockERC20,
        assetWrapper,
        user,
        other,
        lenderPromissoryNote,
        borrowerPromissoryNote,
      } = await setupTestContext();

      const loanTerms = createLoanTerms(assetWrapper.address);
      const bundleId = await initializeBundle(assetWrapper, user);

      const data = buildData(chainId, originationController.address, "originationController", "1", loanTerms);

      const collateralSignature = await user._signTypedData(data.domain, data.types, data.message);
      const { v: collateralV, r: collateralR, s: collateralS } = fromRpcSig(collateralSignature);

      const approvalData = buildData(
        chainId,
        originationController.address,
        "originationController",
        "approvalMessage",
        loanTerms,
      );

      const signature = await user._signTypedData(approvalData.domain, approvalData.types, approvalData.message);

      const { v, r, s } = fromRpcSig(signature);

      expect(
        originationController
          .connect(other)
          .initializeLoanWithCollateralPermit(
            loanTerms,
            await user.getAddress(),
            await other.getAddress(),
            collateralV,
            collateralR,
            collateralS,
            v,
            r,
            s,
          ),
      );
    });
  });
});
