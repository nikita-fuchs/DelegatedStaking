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
const aliceAcc = MemoryAccount.generate();
console.log('alice address:', aliceAcc.address);
console.log('alice secret key:', aliceAcc.secretKey);

const bobAcc = MemoryAccount.generate();
console.log('bob address:', bobAcc.address);
console.log('bob secret key:', bobAcc.secretKey);


const fundSource = new MemoryAccount(`sk_${process.env.FUND_SOURCE_ACC_KEY}`);

const alice = new MemoryAccount(aliceAcc.secretKey);
const bob = new MemoryAccount(bobAcc.secretKey);

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
  accounts: [fundSource, alice, bob],
  onCompiler: new CompilerHttp('https://v8.compiler.aepps.com'),
});

await aeSdk.spend(300, alice.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE});  //0.3 AE
await aeSdk.spend(350, bob.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE}); //0.35 AE

var delegationContract : ContractWithMethods<any>
var stakingValidatorAddress;

var min_delegation_amount
var mainStakingContract
var mainStakingContractAddress
var stakingValidator = await Contract.initialize({
  ...aeSdk.getContext(),
  sourceCode: stakingValidatorContract
});

const firstDelegationAmount = Math.pow(10, 2)
const secondDelegationAmount = Math.pow(10, 2)
const thirdDelegationAmount = Math.pow(10, 2)
const firstReward = Math.pow(10, 3) * 5 // 5000 aettos
var currentEpoch // set by the helper functions, when calling set/adjust epoch

let stopAfterTest = false;

describe('Simple roundtrip:', function () {
  this.timeout(80000);
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
      alice.address,           // producer / validator
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

  it('should register the fundSource as a producer, too, for the rewards of cycling epochs forward in time.', async function () {

    console.log('Calling new_validator');

    var callResult;
    try {
      callResult = await mainStakingContract.new_validator(fundSource.address, fundSource.address, true, {amount: min_delegation_amount, onAccount: fundSource}); // 100 aettos
      console.log('Transaction ID:', callResult.hash);
      console.log('callResult.result.returnType:', callResult.result.returnType);
      console.log('Function call returned:', callResult.decodedResult);
      console.log('type:', typeof(callResult.decodedResult));
    } catch (error) {
      console.log('Calling new_validator errored:', error);
      throw error;
    }

    chai.expect(callResult.result.returnType).to.equal('ok');

});

  it('Alice should be able to delegate stake', async function () {
    await logStateOnContract(mainStakingContract);
    console.log('Calling delegate_stake');

    var callResult;
    try {
      callResult = await delegationContract.delegate_stake({amount: firstDelegationAmount, onAccount: alice}); // 100 aettos
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



it('Alice should NOT be able to withdraw the stake too early ', async function () {
  console.log('Calling request_unstake_delegated_stakes');

  await chai.expect(delegationContract.request_unstake_delegated_stakes({onAccount: alice})).to.be.rejected
  
}); 

it('should be able to fast forward to epoch 2 ', async function () {
  console.log('Calling forwardEpochsBy(1)');
 
 
  let newEpoch = Number(await forwardEpochsBy(1));

  console.log('Checking staked amount:', await getStakedAmount(2));
  await logAwailableBalanceInMainStaking();

  expect(newEpoch).to.equal(2);
});


it('Bob should be able to (delegate) stake again', async function () {
  await logStateOnContract(mainStakingContract);
  console.log('Calling delegate_stake');

  var callResult;
  try {
    callResult = await delegationContract.delegate_stake({amount: secondDelegationAmount, onAccount: bob}); // 100 aettos
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



it('should be able to fast forward by 5 epochs to 7', async function () {
  console.log('Calling debug_fast_forward_epochs');

  let newEpoch = Number(await forwardEpochsBy(5));

  expect(newEpoch).to.equal(7);
});



  it('Alice should be able to (delegate) stake a third time (not eligible for upcoming payouts)', async function () {
    await logStateOnContract(mainStakingContract);
    console.log('Calling delegate_stake');

    var callResult;
    try {
      callResult = await delegationContract.delegate_stake({amount: thirdDelegationAmount, onAccount: alice}); // 100 aettos
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



  it('should find 3 delegations in the list of all delegations', async function () {
    console.log('Calling get_all_delegations');
     
    let {decodedResult} = await delegationContract.get_all_delegations(); 

      console.log('Function call returned:', decodedResult);
          
      let expected =   [{
        delegator: alice.address,
        stake_amount: BigInt(firstDelegationAmount),
        from_epoch: 1n,
        reward: 0n
      },
      {
        delegator: bob.address,
        stake_amount: BigInt(secondDelegationAmount),
        from_epoch: 2n,
        reward: 0n
      },
      {
        delegator: alice.address,
        stake_amount: BigInt(thirdDelegationAmount),
        from_epoch: 7n,
        reward: 0n
                }];

      let equal = isEqual(decodedResult, expected);
      expect(equal).to.equal(true);

});

  it('should find all three delegations and the initial minimum staking amount counted in the staking power of the MainStaking contract', async function () {
    console.log("Checking state:");
    await logStateOnContract(mainStakingContract);
    
    console.log('Calling staking_power');
     
    // the main contract is registering the contract address as an account address inside its owner stuff !
    //let {decodedResult} = await delegationContract.staking_power(delegationContract.$options!.address); 
    let {decodedResult} = await delegationContract.staking_power(); 

      console.log('Function call returned:', decodedResult);
      let sum = BigInt(firstDelegationAmount) + BigInt(secondDelegationAmount) + BigInt(thirdDelegationAmount) + min_delegation_amount;
      console.log('sum:', sum);
      let expectedAmount = sum;
      expect(decodedResult).to.equal(expectedAmount);

});


it('should NOT be able to call delegate_stake without value', async function () {
  console.log('Calling delegate_stake');

  await chai.expect(delegationContract.delegate_stake({onAccount: alice})).to.be.rejected
  
}); 


it('Split rewards: should split rewards to delegators who have delegated for at least 5 epochs', async function () {
      // check the state of the stakingValidator:
      console.log("check the state of the stakingValidator:");

      // await logStateOnContract(stakingValidator);
      /* let state = await stakingValidator.get_state({address: stakingValidatorAddress});

      console.log("stakingValidator state:");
      console.dir(state.decodedResult, { depth: null, colors: true });
       */
      
      // call (modified) MainStaking:
      let res = await mainStakingContract.debug_end_epoch([[alice.address, firstReward]], {amount: firstReward, onAccount: fundSource} );
      currentEpoch = Number(res.decodedResult); // don't forget: splitting rewards increases the epoch by 1!

      // retrieve the last values passed to the delegation stake's callback function:
      let lastValues = await delegationContract.debug_get_last_cb_values();
      console.log('last values passed to callback function:', lastValues.decodedResult);

      // expect that only one delegation got all the rewards, as it's the only one who has staked for long enough.
      let expected =   [{
        delegator: alice.address,
        stake_amount: BigInt(firstDelegationAmount),
        from_epoch: 1n,
        reward: 2500n
      },
      {
        delegator: bob.address,
        stake_amount: BigInt(secondDelegationAmount),
        from_epoch: 2n,
        reward: 2500n
      },
      {
        delegator: alice.address,
        stake_amount: BigInt(thirdDelegationAmount),
        from_epoch: 7n,
        reward: 0n
                }];


      console.log('Calling get_all_delegations');
      let {decodedResult} = await delegationContract.get_all_delegations(); 
      console.log('Listing all delegations:', decodedResult);

      let equal = isEqual(decodedResult, expected);
      expect(equal).to.equal(true);
      
    }); 


it('should be able to fast forward an epoch by 5 to 13', async function () {
      console.log('Calling forwardEpochsBy');
    
      let newEpoch = Number(await forwardEpochsBy(5));
      expect(newEpoch).to.equal(13);
    });
  
it('Split rewards again: should split rewards to delegators who have delegated for at least 5 epochs', async function () {
      // check the state of the stakingValidator:
      console.log("check the state of the stakingValidator:");

      // await logStateOnContract(stakingValidator);
      /* let state = await stakingValidator.get_state({address: stakingValidatorAddress});

      console.log("stakingValidator state:");
      console.dir(state.decodedResult, { depth: null, colors: true });
       */
      
      // call (modified) MainStaking:
      let res = await mainStakingContract.debug_end_epoch([[alice.address, firstReward]], {amount: firstReward, onAccount: fundSource} );
      currentEpoch = Number(res.decodedResult); // don't forget: splitting rewards increases the epoch by 1!

      // retrieve the last values passed to the delegation stake's callback function:
      let lastValues = await delegationContract.debug_get_last_cb_values();
      console.log('last values passed to callback function:', lastValues.decodedResult);

      // expect that only one delegation got all the rewards, as it's the only one who has staked for long enough.
      let expected =   [{
        delegator: alice.address,
        stake_amount: BigInt(firstDelegationAmount),
        from_epoch: 1n,
        reward: 4166n
      },
      {
        delegator: bob.address,
        stake_amount: BigInt(secondDelegationAmount),
        from_epoch: 2n,
        reward: 4166n
      },
      {
        delegator: alice.address,
        stake_amount: BigInt(thirdDelegationAmount),
        from_epoch: 7n,
        reward: 1666n
                }];


      console.log('Calling get_all_delegations');
      let {decodedResult} = await delegationContract.get_all_delegations(); 
      console.log('Listing all delegations:', decodedResult);

      let equal = isEqual(decodedResult, expected);
      expect(equal).to.equal(true);
      
    }); 



it(' Delegation contract should have no balance available in main staking, because everything is restaked:', async function () {
      // call function
      console.log('Calling get_available_balance');
  
      var callResult;
      
      try {
          callResult = await delegationContract.get_available_balance();
          console.log('get_available_balance Function call returned:', callResult.decodedResult);
        } catch (error) {
          console.log('Calling get_available_balance errored:', error);
          throw error;
        }
       
  /* 
        let call = await delegationContract.stub_debug_get_state()
        let state = call.decodedResult;
        var withdrawnReward = state.debug_last_withdrawn_amount
        console.log("withdrawnReward:", withdrawnReward);
  
        console.dir(state.decodedResult, { depth: null, colors: true });
  
        chai.expect(callResult!.result.returnType).to.equal('ok') &&
        chai.expect(withdrawnReward).to.equal(BigInt(Math.pow(10, 17) / 2)); // 0,05 AE
        */
        chai.expect(callResult.decodedResult).to.equal(0n);
    }); 

it('Bob should be able to initiate the withdrawal of his rewards', async function () {
    console.log("currentEpoch:", await getCurrentEpoch());
    // call function
    console.log('Calling request_withdraw_rewards');

    var callResult;
    
    try {
        callResult = await delegationContract.request_withdraw_rewards({onAccount: bob});
        console.log('request_withdraw_rewards Transaction ID:', callResult.hash);
        console.log('request_withdraw_rewards Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling request_withdraw_rewards errored:', error);
        throw error;
      }

      await logStateOnContract(delegationContract);
/* 
      let call = await delegationContract.stub_debug_get_state()
      let state = call.decodedResult;
      var withdrawnReward = state.debug_last_withdrawn_amount
      console.log("withdrawnReward:", withdrawnReward);

      console.dir(state.decodedResult, { depth: null, colors: true });

      chai.expect(callResult!.result.returnType).to.equal('ok') &&
      chai.expect(withdrawnReward).to.equal(BigInt(Math.pow(10, 17) / 2)); // 0,05 AE
      */
      chai.expect(callResult.decodedResult).to.equal(`WAIT TILL EPOCH ${currentEpoch + 6}`);
  }); 

  it('Alice should be able to initiate the withdrawal of her rewards', async function () {
    console.log("currentEpoch:", await getCurrentEpoch());
    // call function
    console.log('Calling request_withdraw_rewards');

    var callResult;
    
    try {
        callResult = await delegationContract.request_withdraw_rewards({onAccount: alice});
        console.log('request_withdraw_rewards Transaction ID:', callResult.hash);
        console.log('request_withdraw_rewards Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling request_withdraw_rewards errored:', error);
        throw error;
      }

      await logStateOnContract(delegationContract);
/* 
      let call = await delegationContract.stub_debug_get_state()
      let state = call.decodedResult;
      var withdrawnReward = state.debug_last_withdrawn_amount
      console.log("withdrawnReward:", withdrawnReward);

      console.dir(state.decodedResult, { depth: null, colors: true });

      chai.expect(callResult!.result.returnType).to.equal('ok') &&
      chai.expect(withdrawnReward).to.equal(BigInt(Math.pow(10, 17) / 2)); // 0,05 AE
      */
      chai.expect(callResult.decodedResult).to.equal(`WAIT TILL EPOCH ${currentEpoch + 6}`);
  }); 


  it('Alice should be able to initiate the unstaking of her stake', async function () {
    console.log("currentEpoch:", await getCurrentEpoch());
    // call function
    console.log('Calling request_withdraw_rewards');

    var callResult;
    
    try {
        callResult = await delegationContract.request_unstake_delegated_stakes({onAccount: alice});
        console.log('request_withdraw_rewards Transaction ID:', callResult.hash);
        console.log('request_withdraw_rewards Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling request_withdraw_rewards errored:', error);
        throw error;
      }

      await logStateOnContract(delegationContract);

      chai.expect(callResult.decodedResult).to.equal(`WAIT TILL EPOCH ${currentEpoch + 6}`);
  }); 


 it('Alice should NOT be able to initiate unstaking of any delegations or rewards anymore', async function () {
  // call function
  console.log('Calling request_withdraw_rewards');

   await chai.expect(delegationContract.request_unstake_delegated_stakes({onAccount: alice})).to.be.rejected;
}); 


it('should be able to fast forward an epoch by 1 to 15', async function () {
    console.log("currentEpoch:", await getCurrentEpoch());
    console.log('Calling forwardEpochsBy');
  
    let newEpoch = Number(await forwardEpochsBy(1));
    expect(newEpoch).to.equal(15);
  });

it(' Bob should NOT be able to request a second withdrawal, when he doesnt have any rewards to withdraw', async function () {
        // call function
        console.log('Calling request_withdraw_rewards, again');
        await chai.expect(delegationContract.request_withdraw_rewards({onAccount: bob})).to.be.rejected
    
 }); 

it('Bob should not be able to withdraw queued funds too early', async function () {
  
  // get current balance in queue:
  console.log("currentEpoch:", await getCurrentEpoch());

  chai.expect(delegationContract.withdraw({onAccount: bob})).to.be.rejected;
}); 

it('should be able to fast forward an epoch by 5 to 20', async function () {
  console.log("currentEpoch:", await getCurrentEpoch());
  console.log('Calling forwardEpochsBy');

  let newEpoch = Number(await forwardEpochsBy(5));
  expect(newEpoch).to.equal(20);
});

 it('Alice should be able to withdraw queued funds (stake and rewards)', async function () {
  
  // get all current balances in queue:

  let state : any = await logStateOnContract(delegationContract);
  let all = state.queued_withdrawals;   
  const array = all.entries().next().value[1];
  console.log("array:", array);

  let firstValue = array[0];
  console.log("firstValue:", firstValue);
  let secondValue = array[1];
  console.log("secondValue:", secondValue);

  let finalSum = firstValue.amount + secondValue.amount;
  console.log("finalSum:", finalSum);

  await logAwailableBalanceInMainStaking();

  await logStateOnContract(delegationContract);

  var callResult;
  
  try {
      callResult = await delegationContract.withdraw({onAccount: alice});
      console.log('withdraw Transaction ID:', callResult.hash);
      console.log('withdraw Function call returned:', callResult.decodedResult);
    } catch (error) {
      console.log('Calling withdraw errored:', error);
      throw error;
    }

    await logStateOnContract(delegationContract);
    

    chai.expect(callResult.decodedResult).to.equal(finalSum);
}); 

 it('Bob should be able to withdraw queued funds (rewards)', async function () {
  
  // get current balance in queue:

  let state : any = await logStateOnContract(delegationContract);
  let all = state.queued_withdrawals as Map<any, any>;   
  const value = all.get(bob.address)
  console.log("array:", value);

  let firstValue = all.get(bob.address)[0];
  console.log("firstValue:", firstValue);

  let finalSum = firstValue.amount
  console.log("finalSum:", finalSum);

  await logAwailableBalanceInMainStaking();

  await logStateOnContract(delegationContract);

  var callResult;
  
  try {
      callResult = await delegationContract.withdraw({onAccount: bob});
      console.log('withdraw Transaction ID:', callResult.hash);
      console.log('withdraw Function call returned:', callResult.decodedResult);
    } catch (error) {
      console.log('Calling withdraw errored:', error);
      throw error;
    }

    await logStateOnContract(delegationContract);
    

    chai.expect(callResult.decodedResult).to.equal(finalSum);
}); 
 

function forwardEpochsBy(count){
  return new Promise(async (resolve, reject) => {
    try {
      let { decodedResult } = await mainStakingContract.debug_fast_forward_epochs(count, fundSource.address, {onAccount: fundSource, amount: count});
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
    console.log(`State (${contract._name}):`);
    console.dir(state.decodedResult, { depth: null, colors: true });
    resolve(state.decodedResult);
  });
}

function logAwailableBalanceInMainStaking(){
  return new Promise(async (resolve, reject) => {
    console.log('checking available balance in main staking :');
    var callResult = await delegationContract.get_available_balance();
    console.log('get_available_balance Function call returned:', callResult.decodedResult);
  
    resolve(callResult.decodedResult);
  });
}


function  getStakedAmount(epoch){
  return new Promise(async (resolve, reject) => {
    try{

      var callResult = await delegationContract.get_total_staked_amount(epoch);
      resolve(callResult.decodedResult);
    } catch (error) {
      reject(error);
    }
  });
}

function getCurrentEpoch(){
  return new Promise(async (resolve, reject) => {
    try {
      let { decodedResult } = await mainStakingContract.get_current_epoch();
      currentEpoch = Number(decodedResult);
      resolve(currentEpoch);
    } catch(e) {
      reject(e); 
    }
  });
}


});
