pragma solidity ^0.8.0; 

/**
Fee Controller is intended to be an upgradable component of Pawnfi
where new fees can be added or modified based on different user attributes 

Type/size of loan being requested 
Amount of tokens being staked, etc

Version 1 (as of 4/21/2021) Capabilities: 

FeeController will be called once after a loan has been matched so that we can
create an origination fee (2% credited to PawnFi) 

*/


contract FeeController { 


    struct FeeController{ 

        float originationFee;

    }



    /** @dev Returns the type of fee given certain business logic
    
    E.g. Random user's loan request for 2 wETH is matched with a lender
    Function is called to determine origination fee and fee rate given loan 
    amount is returned 

    * Requirements: 

    * - type must be a valid type supported by contract 
    * - amount for loan must be greater than 0 
    * - address must be a valid ERC20  contract implementing balanceOf


    */

    function getFeeOfType(EventType type, 
    uint256 amount, 
    address payer) returns(float) {

        if (keccak256(bytes(type)) == keccak256(bytes("originationFee"))) {

            originationFee = amount * .02;
            return originationFee;

    }








}