// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./libraries/LoanData.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IRepaymentController.sol";

contract RepaymentController is IRepaymentController {
    using SafeMath for uint256;

    ILoanCore private loanCore;
    IPromissoryNote private borrowerNote;
    IPromissoryNote private lenderNote;
    
    constructor(
        ILoanCore _loanCore,
        IPromissoryNote _borrowerNote,
        IPromissoryNote _lenderNote
    ) {
        require(_loanCore != address(0), "loanCore address must be defined");

        bytes4 loanCoreInterface = type(ILoanCore).interfaceId;
        require(IERC165(_loanCore).supportsInterface(loanCoreInterface), "loanCore must be an instance of LoanCore");

        loanCore = ILoanCore(_loanCore);

        borrowerNote = _borrowerNote;
        lenderNote = _lenderNote;
    }

    /**
     * @inheritdoc IRepaymentController
     */
    function repay(uint256 borrowerNoteId) external override {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId[borrowerNoteId];
        require(loanId != 0, "RepaymentController: repay could not dereference loan");

        LoanTerms terms = loanCore.loans[loanId].terms;

        // withdraw principal plus interest from borrower and send to loan core
        IERC20(terms.payableCurrency).transferFrom(
            msg.sender, 
            address(loanCore), 
            terms.principal.add(terms.interest)
        );

        // call repay function in loan core
        _loanCore.repay(loanId);
    }

    /**
     * @inheritdoc IRepaymentController
     */
    function claim(uint256 lenderNoteId) external override {
        // make sure that caller owns lender note
        address lender = _lenderNote.ownerOf(lenderNoteId);
        require(lender == msg.sender, "RepaymentController: only lender can claim a lender note");

        // get loan from lender note
        uint256 loanId = borrowerNote.loanIdByNoteId[borrowerNoteId];
        require(loanId != 0, "RepaymentController: claim could not dereference loan");

        // call claim function in loan core
        _loanCore.claim(loanId);
    }
}