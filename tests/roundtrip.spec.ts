import { describe } from "mocha";
import * as chai from 'chai'    
import { expect } from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import { stakingValidatorContract } from "./stakingValidator.ts";
chai.use(chaiAsPromised)

import pkg from 'lodash';
const { isEqual } = pkg;

import { AeSdk, MemoryAccount, Node, CompilerHttp, Contract, getBalance, AE_AMOUNT_FORMATS, decode, unpackTx } from '@aeternity/aepp-sdk';
import sourceCode from './sourceCode.ts';
import mainStakingSource from "./MainStakingAndStakingValidator.ts";
import * as dotenv from 'dotenv';
import ContractWithMethods from "@aeternity/aepp-sdk/es/contract/Contract";
dotenv.config();

console.log('Funding generated accounts...')
const producerAcc = MemoryAccount.generate();
console.log('producer address:', producerAcc.address);
console.log('producer secret key:', producerAcc.secretKey);

const delegatorAcc = MemoryAccount.generate();
console.log('delegator address:', delegatorAcc.address);
console.log('delegator secret key:', delegatorAcc.secretKey);

const fundSource = new MemoryAccount(`sk_${process.env.FUND_SOURCE_ACC_KEY}`);

const producer = new MemoryAccount(producerAcc.secretKey);
const delegator = new MemoryAccount(delegatorAcc.secretKey);

console.log('Blockproducer address:', fundSource.address);

// instantiate a connection to aeternity
const nodeUrl = process.env.NODE_URL || 'https://mainnet.aeternity.io';
const node = new Node(nodeUrl);

//NOTE: for debugging, you can log the contract state like this:
/*     console.log("state:");
    let stateLog = await stakingContract.stub_debug_get_state();
    console.dir(stateLog.decodedResult, { depth: null, colors: true });
 */

console.log("Fund source balance:", await getBalance(fundSource.address, {onNode: node, format: AE_AMOUNT_FORMATS.AE}));

// create an SDK instance
const aeSdk = new AeSdk({
  nodes: [{ name: 'network', instance: node }],
  accounts: [fundSource, producer, delegator],
  onCompiler: new CompilerHttp('https://v8.compiler.aepps.com'),
});

await aeSdk.spend(300, producer.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE});  //0.3 AE
await aeSdk.spend(350, delegator.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE}); //0.35 AE

var delegationContract : ContractWithMethods<any>
var stakingValidatorAddress;

var min_delegation_amount
var mainStakingContract
var mainStakingContractAddress
var stakingValidator = await Contract.initialize({
  ...aeSdk.getContext(),
  sourceCode: stakingValidatorContract
});

const fistDelegationAmount = Math.pow(10, 2)
const secondDelegationAmount = Math.pow(10, 2)
const firstReward = Math.pow(10, 3) * 5 // 50000 aettos
var currentEpoch // set by the helper functions, when calling set/adjust epoch

let stopAfterTest = false;

describe('Simple roundtrip:', function () {

  beforeEach(async function () {

    if (stopAfterTest) {
      this.skip(); // Skip remaining tests
    }

    console.log('Waiting to prevent nonce issue...');
    // wait for 4 seconds
    await new Promise(resolve => setTimeout(resolve, 4000));
  });

  it('should set up the sdk and connect to AE', async function () {
    const height = await aeSdk.getHeight();
    console.log('Connected to Mainnet Node! Current Block:', height);
    chai.expect(height).to.be.a('number');
  });


  it('Should deploy the Main Staking Contract and read min_delegation_amount', async function () {

    var args = [
      100 //validator_min_stake, // 100 aettos
    ]
    // create a contract instance
    mainStakingContract = await Contract.initialize({
      ...aeSdk.getContext(),
      sourceCode: mainStakingSource,
    });

    // Deploy the contract
    let deployInfo;
    try {
      console.log('Deploying contract....');
      console.log('Using account for deployment:', aeSdk.address);
      deployInfo = await mainStakingContract.init(...args, {onAccount: fundSource});
      mainStakingContractAddress = deployInfo.address;
    } catch (error) {
      console.log('Something went wrong, did you set up the SDK properly?');
      console.log('Deployment failed:');
      throw error;
    }
    console.log('Main staking contract deployed successfully!');
    console.log('Contract address:', mainStakingContract!.$options!.address);
    //@ts-ignore
    console.log('Transaction ID:', deployInfo.transaction);

    let { decodedResult } = await mainStakingContract.get_validator_min_stake();
    min_delegation_amount = decodedResult;

    chai.expect(mainStakingContract!.$options!.address!.startsWith("ct_")).to.eql(true);
  });

  it('Should deploy the Delegated Staking Contract (and call MainStaking to create a stakingValidator)', async function () {

    console.log("min_delegation_amount:", min_delegation_amount);
    var args = [
      producer.address,           // producer / validator
      mainStakingContractAddress, // mainStaking contract
      min_delegation_amount,      // min_delegation_amount
      2,                          // max_delegators
      5,                          // min_delegation_duration 
      3                           // max_withdrawal_queue_length : int) =
    ]

  
    // create a contract instance
    delegationContract = await Contract.initialize({
      ...aeSdk.getContext(),
      sourceCode,
    });

    // Deploy the contract
    let deployInfo;
    try {
      console.log('Deploying contract....');
      console.log('Using account for deployment:', aeSdk.address);
      deployInfo = await delegationContract.init(...args, {amount: min_delegation_amount, onAccount: fundSource});
      //console.log('deployInfo:', deployInfo);
    } catch (error) {
      console.log('Deployment failed:', unpackTx(error.transaction));
      throw error;
    }

    console.log('Delegated staking contract deployed successfully!');
    console.log('Contract address:', delegationContract!.$options!.address);
    //@ts-ignore
    console.log('Transaction ID:', deployInfo.transaction);




      // find the address of the stakingValidator contract:

      let state = await mainStakingContract.get_state();

   //   console.log("state.decodedResult :", state.decodedResult);
      let all = state.decodedResult.validators;
 //     console.log("state.decodedResult.validators", state.decodedResult.validators);
  
      const first = Array.from(all)[0]
      //console.log("first validator:", first);
      //console.log("Contract address:", first[0]);
      stakingValidatorAddress = 'ct_' + first[0].slice(3);
      console.log("stakingValidatorAddress:", stakingValidatorAddress);


    chai.expect(delegationContract!.$options!.address!.startsWith("ct_")).to.eql(true);


  });

  it('should be able to (delegate) stake', async function () {
    await logStateOnContract(mainStakingContract);
    console.log('Calling delegate_stake');



    

    var callResult;
    try {
      callResult = await delegationContract.delegate_stake({amount: fistDelegationAmount, onAccount: producer}); // 100 aettos
      console.log('Transaction ID:', callResult.hash);
      console.log('callResult.result.returnType:', callResult.result.returnType);
      console.log('Function call returned:', callResult.decodedResult);
      console.log('type:', typeof(callResult.decodedResult));
    } catch (error) {
      console.log('Calling register_as_delegatee errored:', error);
      throw error;
    }
    chai.expect(callResult.result.returnType).to.equal('ok');

});

it('should be able to set an epoch (6)', async function () {
  console.log('Calling debug_set_epoch_to');

  let newEpoch = Number(await setEpochTo(6));
  expect(newEpoch).to.equal(6);
});

  it('should be able to (delegate) stake a second time', async function () {
    await logStateOnContract(mainStakingContract);
    console.log('Calling delegate_stake');

    var callResult;
    try {
      callResult = await delegationContract.delegate_stake({amount: secondDelegationAmount, onAccount: producer}); // 100 aettos
      console.log('Transaction ID:', callResult.hash);
      console.log('callResult.result.returnType:', callResult.result.returnType);
      console.log('Function call returned:', callResult.decodedResult);
      console.log('type:', typeof(callResult.decodedResult));
    } catch (error) {
      console.log('Calling register_as_delegatee errored:', error);
      throw error;
    }
    chai.expect(callResult.result.returnType).to.equal('ok');

});



  it('should find both delegations in the list of all delegations', async function () {
    console.log('Calling get_all_delegations');
     
    let {decodedResult} = await delegationContract.get_all_delegations(); 

      console.log('Function call returned:', decodedResult);
          
      let expected =   [{
        delegator: producer.address,
        stake_amount: BigInt(fistDelegationAmount),
        from_epoch: 1n,
        reward: 0n
      },
      {
        delegator: producer.address,
        stake_amount: BigInt(secondDelegationAmount),
        from_epoch: 6n,
        reward: 0n
                }];

      let equal = isEqual(decodedResult, expected);
      expect(equal).to.equal(true);

});

  it('should find both delegations and the initial minimum staking amount in the staking power of the MainStaking contract', async function () {
    console.log("Checking state:");
    await logStateOnContract(mainStakingContract);
    
    console.log('Calling staking_power');
     
    // the main contract is registering the contract address as an account address inside its owner stuff !
    //let {decodedResult} = await delegationContract.staking_power(delegationContract.$options!.address); 
    let {decodedResult} = await delegationContract.staking_power(); 

      console.log('Function call returned:', decodedResult);
      let sum = BigInt(fistDelegationAmount) + BigInt(secondDelegationAmount) + min_delegation_amount;
      console.log('sum:', sum);
      let expectedAmount = sum;
      expect(decodedResult).to.equal(expectedAmount);

});


it('should NOT be able to call delegate_stake without value', async function () {
  console.log('Calling delegate_stake');

  await chai.expect(delegationContract.delegate_stake({onAccount: producer})).to.be.rejected
  
}); 

    
/*     it('should just get the state', async function () {
      let state = await stakingContract.stub_debug_get_state();  
    }); 
 */



    /* // cheating: 
    console.log("state:");
    let state = await stakingContract.stub_debug_get_state();
    console.dir(state.decodedResult, { depth: null, colors: true });
 */

    it('Split rewards: should split rewards to delegators who have delegated for at least 5 epochs', async function () {
      // check the state of the stakingValidator:
      console.log("check the state of the stakingValidator:");

      // await logStateOnContract(stakingValidator);
    /*   let state = await stakingValidator.get_state({address: stakingValidatorAddress});

      console.log("stakingValidator state:");
      console.dir(state.decodedResult, { depth: null, colors: true });
       */
      // call (modified) MainStaking:
      let res = await mainStakingContract.add_rewards(6, [[producer.address, firstReward]], {amount: firstReward, onAccount: fundSource} );

      // retrieve the last values passed to the delegation stake's callback function:
      let lastValues = await delegationContract.debug_get_last_cb_values();
      console.log('last values passed to callback function:', lastValues.decodedResult);

      // expect that only one delegation got all the rewards, as it's the only one who has staked for long enough.
      let expected =   [{
        delegator: producer.address,
        stake_amount: BigInt(fistDelegationAmount),
        from_epoch: 1n,
        reward: 50000n
      },
      {
        delegator: producer.address,
        stake_amount: BigInt(secondDelegationAmount),
        from_epoch: 6n,
        reward: 0n
                }];


      console.log('Calling get_all_delegations');
      let {decodedResult} = await delegationContract.get_all_delegations(); 
      console.log('Listing all delegations:', decodedResult);

      let equal = isEqual(decodedResult, expected);
      expect(equal).to.equal(true);
      stopAfterTest = true;
    }); 


    
  
  it('delegator should be able to withdraw his reward', async function () {
    // call function
    console.log('Calling withdraw_rewards');

    var callResult;
    
    try {
        callResult = await delegationContract.withdraw_rewards(producer.address, {onAccount: delegator});
        console.log('Transaction ID:', callResult.hash);
        console.log('Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling withdraw_rewards errored:', error);
        throw error;
      }

      let call = await delegationContract.stub_debug_get_state()
      let state = call.decodedResult;
      var withdrawnReward = state.debug_last_withdrawn_amount
      console.log("withdrawnReward:", withdrawnReward);

      console.dir(state.decodedResult, { depth: null, colors: true });

      chai.expect(callResult!.result.returnType).to.equal('ok') &&
      chai.expect(withdrawnReward).to.equal(BigInt(Math.pow(10, 17) / 2)); // 0,05 AE

  }); 


 
  it('should not withdraw anything a second time / if you don`t have any rewards to withdraw', async function () {
        // call function
        console.log('Calling withdraw_rewards, again');
        await chai.expect(delegationContract.withdraw_rewards(producer.address, {onAccount: delegator})).to.be.rejected
    
 }); 


 

   /* 
  
  it('the decreased stake amount is correctly noted in the delegation bookkeeping', function () {
    chai.expect(false).to.be.a('boolean');
  }); 

  */

    /* 
  
  it('payouts should happen correctly after staker adjusts his stake', function () {
    chai.expect(false).to.be.a('boolean');
  }); 
  */

function adjustEpochBy(amount){
  return new Promise(async (resolve, reject) => {
    try {
      let { decodedResult } = await mainStakingContract.debug_adjust_epoch_by(amount);
      currentEpoch = Number(decodedResult);
      resolve(decodedResult);
    } catch(e) {
      reject(e); 
    }
  });
}

function setEpochTo(amount){
  return new Promise(async (resolve, reject) => {
    try {
      let { decodedResult } = await mainStakingContract.debug_set_epoch_to(amount);
      currentEpoch = Number(decodedResult);
      resolve(decodedResult);
    } catch(e) {
      reject(e); 
    }
  });
}

function logStateOnContract(contract : ContractWithMethods<any>){
  return new Promise(async (resolve, reject) => {
    let state = await contract.get_state();
    console.log("state:");
    console.dir(state.decodedResult, { depth: null, colors: true });
    resolve(true);
  });
}

});
