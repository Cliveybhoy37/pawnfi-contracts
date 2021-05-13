// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "./interfaces/ILenderNote.sol";
import "./interfaces/ILoanCore.sol";

/**
 * Built off Openzeppelin's ERC721PresetMinterPauserAutoId.
 *
 * @dev {ERC721} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - token ID and URI autogeneration
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract LenderNote is Context, AccessControlEnumerable, ERC721, ERC721Enumerable, ERC721Pausable, ILenderNote {
    using Counters for Counters.Counter;

    bytes32 public constant LOAN_CORE_ROLE = keccak256("LOAN_CORE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    Counters.Counter private _tokenIdTracker;

    address public loanCore;

    /**
     * @dev Grants `LOAN_CORE_ROLE` to the specified loanCore-
     * contract, provided it is an instance of LoanCore.
     *
     * Grants `DEFAULT_ADMIN_ROLE` to the account that deploys the contract. Admins
     * can pause the contract if needed.
     *
     */
    constructor(
        string memory name,
        string memory symbol,
        address _loanCore
    ) ERC721(name, symbol) {
        require(_loanCore != address(0), "loanCore address must be defined");

        bytes4 loanCoreInterface = type(ILoanCore).interfaceId;
        require(IERC165(_loanCore).supportsInterface(loanCoreInterface), "loanCore must be an instance of LoanCore");

        _setupRole(LOAN_CORE_ROLE, _loanCore);
        loanCore = _loanCore;

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        // TODO: This pause might be good for alpha. Should we remove for mainnet?
        _setupRole(PAUSER_ROLE, _msgSender());
    }

    /**
     * @inheritdoc ILenderNote
     */
    function mint(address to) public override {
        require(hasRole(LOAN_CORE_ROLE, _msgSender()), "LenderNote: only LoanCore contract can mint");

        // We cannot just use balanceOf to create the new tokenId because tokens
        // can be burned (destroyed), so we need a separate counter.
        _mint(to, _tokenIdTracker.current());
        _tokenIdTracker.increment();
    }

    /**
     * @inheritdoc ILenderNote
     */
    function burn(uint256 tokenId) public override {
        require(hasRole(LOAN_CORE_ROLE, _msgSender()), "LenderNote: only LoanCore can burn");

        _burn(tokenId);
    }

    /**
     * @inheritdoc ILenderNote
     */
    function pause() public override {
        require(hasRole(PAUSER_ROLE, _msgSender()), "LenderNote: must have pauser role to pause");
        _pause();
    }

    /**
     * @inheritdoc ILenderNote
     */
    function unpause() public override {
        require(hasRole(PAUSER_ROLE, _msgSender()), "LenderNote: must have pauser role to unpause");
        _unpause();
    }

    /**
     * @dev Hook called before transfer of tokens, including minting and burning.
     * Part of OpenZeppelin's ERC721 implementation.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721, ERC721Enumerable, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(IERC165, AccessControlEnumerable, ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
