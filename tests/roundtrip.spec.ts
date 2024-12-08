import { describe } from "mocha";
import * as chai from 'chai'    
import chaiAsPromised from 'chai-as-promised'
chai.use(chaiAsPromised)


import { AeSdk, MemoryAccount, Node, CompilerHttp, Contract, getBalance, AE_AMOUNT_FORMATS, decode, unpackTx } from '@aeternity/aepp-sdk';
import sourceCode from './sourceCode.ts';
import mainStakingSource from "./MainStakingAndStakingValidator.ts";
import * as dotenv from 'dotenv';
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

await aeSdk.spend(700, producer.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE});  //0.7 AE
await aeSdk.spend(350, delegator.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE}); //0.35 AE

var stakingContract
var stakingContractAddress

var min_delegation_amount
var mainStakingContract
var mainStakingContractAddress
var stakingValidator

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
    console.log('Contract deployed successfully!');
    console.log('Contract address:', mainStakingContract!.$options!.address);
    //@ts-ignore
    console.log('Transaction ID:', deployInfo.transaction);

    let { decodedResult } = await mainStakingContract.get_validator_min_stake();
    min_delegation_amount = decodedResult;

    chai.expect(mainStakingContract!.$options!.address!.startsWith("ct_")).to.eql(true);
  });

  it('Should deploy the Delegated Staking Contract', async function () {

    console.log("min_delegation_amount", min_delegation_amount);
    var args = [
      producer.address,           // producer / validator
      mainStakingContractAddress, // mainStaking contract
      min_delegation_amount,      // min_delegation_amount
      2,                          // max_delegators
      5,                          // min_delegation_duration 
      3                           // max_withdrawal_queue_length : int) =
    ]


    // create a contract instance
    stakingContract = await Contract.initialize({
      ...aeSdk.getContext(),
      sourceCode,
    });

    // Deploy the contract
    let deployInfo;
    try {
      console.log('Deploying contract....');
      console.log('Using account for deployment:', aeSdk.address);
      deployInfo = await stakingContract.init(...args, {amount: 100, onAccount: fundSource});
      //console.log('deployInfo:', deployInfo);
    } catch (error) {
      console.log('Deployment failed:', unpackTx(error.transaction));
      throw error;
    }

    console.log('Contract deployed successfully!');
    console.log('Contract address:', stakingContract!.$options!.address);
    //@ts-ignore
    console.log('Transaction ID:', deployInfo.transaction);


    chai.expect(stakingContract!.$options!.address!.startsWith("ct_")).to.eql(true);


  });

  it('should be able to (delegate) stake', async function () {
    console.log('Calling delegate_stake');

    var callResult;
    try {
      callResult = await stakingContract.delegate_stake({amount: Math.pow(10, 2), onAccount: producer}); // 100 aettos
      console.log('Transaction ID:', callResult.hash);
      console.log('callResult.result.returnType:', callResult.result.returnType);
      console.log('Function call returned:', callResult.decodedResult);
      console.log('type:', typeof(callResult.decodedResult));
    } catch (error) {
      console.log('Calling register_as_delegatee errored:', error);
      throw error;
    }
    chai.expect(callResult.result.returnType).to.equal('ok');


    stopAfterTest = true;
});

    
/*     it('should just get the state', async function () {
      let state = await stakingContract.stub_debug_get_state();  
    }); 
 */
  
  it('Split rewards: should NOT split rewards to delegators who have not delegated for at least 5 epochs, but STILL reward delegatee(producer) even if he just staked', async function () {

    // call function
    console.log('Calling split_reward_to_delegators');

    var callResult;
    try {
      callResult = await stakingContract.split_reward_to_delegators({amount: Math.pow(10, 17), onAccount: producer}); //0.1 AE
      console.log('Transaction ID:', callResult.hash);
      console.log('Function call returned:', callResult.decodedResult);
    } catch (error) {
      console.log('Calling split_reward_to_delegators errored:', error);
      throw error;
    }

    let resDelegatee = await stakingContract.calculate_accumulated_rewards_per_delegatee_per_delegator(producer.address, producer.address);
    let rewardsDelegatee = resDelegatee.decodedResult;
    console.log("rewardsDelegatee:", rewardsDelegatee);

    let resDelegator = await stakingContract.calculate_accumulated_rewards_per_delegatee_per_delegator(producer.address, delegator.address);
    let rewardsDelegator = resDelegator.decodedResult;
    console.log("rewardsDelegator:", rewardsDelegator);
    
  
    chai.expect(rewardsDelegatee).to.equal(BigInt(Math.pow(10, 17))) && // 0,1 AE 
    chai.expect(rewardsDelegator).to.equal(0n);
  }); 


    /* // cheating: 
    console.log("state:");
    let state = await stakingContract.stub_debug_get_state();
    console.dir(state.decodedResult, { depth: null, colors: true });
 */

    it('Split rewards: should split rewards to delegators who have delegated for at least 5 epochs as well as delegatee (producer)', async function () {

      let res = await stakingContract.stub_debug_get_epoch();
      let currentEpoch = Number(res.decodedResult);
      console.log("Current Epoch:", currentEpoch);
      console.log('Increasing Epoch by 5...');
      let res2 = await stakingContract.stub_debug_set_epoch(currentEpoch + 5);
      let newEpoch = res2.decodedResult;
      console.log("New Epoch:", newEpoch);

      // call function
      console.log('Calling split_reward_to_delegators');
  
      var callResult;
      try {
        callResult = await stakingContract.split_reward_to_delegators({amount: Math.pow(10, 17), onAccount: producer}); //0.1 AE
        console.log('Transaction ID:', callResult.hash);
        console.log('Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling split_reward_to_delegators errored:', error);
        throw error;
      }
  
      let resDelegatee = await stakingContract.calculate_accumulated_rewards_per_delegatee_per_delegator(producer.address, producer.address);
      let rewardsDelegatee = resDelegatee.decodedResult;
      console.log("rewardsDelegatee:", rewardsDelegatee);
  
      let resDelegator = await stakingContract.calculate_accumulated_rewards_per_delegatee_per_delegator(producer.address, delegator.address);
      let rewardsDelegator = resDelegator.decodedResult;
      console.log("rewardsDelegator:", rewardsDelegator);
 
      chai.expect(rewardsDelegatee).to.equal(BigInt(Math.pow(10, 17) / 2) + BigInt(Math.pow(10, 17))) && // 0,15 AE (previous rewards + 0,5 AE for 50% now) 
      chai.expect(rewardsDelegator).to.equal(BigInt(Math.pow(10, 17) / 2)); // 0,05 AE (as ther delegator is eligible now)
    }); 


    
  
  it('delegator should be able to withdraw his reward', async function () {
    // call function
    console.log('Calling withdraw_rewards');

    var callResult;
    
    try {
        callResult = await stakingContract.withdraw_rewards(producer.address, {onAccount: delegator});
        console.log('Transaction ID:', callResult.hash);
        console.log('Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling withdraw_rewards errored:', error);
        throw error;
      }

      let call = await stakingContract.stub_debug_get_state()
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
        await chai.expect(stakingContract.withdraw_rewards(producer.address, {onAccount: delegator})).to.be.rejected
    
 }); 


 
it('staker should be able to increase his stake', async function () {
  console.log('Calling stub_stake');

  let call = await stakingContract.stub_get_stake(producer.address);
  let oldBalance = call.decodedResult;

  var callResult;
  try {
    callResult = await stakingContract.stub_stake({amount: (2 * Math.pow(10, 17)), onAccount: producer}); // add 0,2 AE
    console.log('Transaction ID:', callResult.hash);
    console.log('callResult.result.returnType:', callResult.result.returnType);
    console.log('Function call returned:', callResult.decodedResult);
  } catch (error) {
    console.log('Calling register_as_delegatee errored:', error);
    throw error;
  }

  let call2 = await stakingContract.stub_get_stake(producer.address);
  let newBalance = call2.decodedResult;

  console.log("oldBalance:", oldBalance);
  console.log("newBalance:", newBalance);

  chai.expect(newBalance - oldBalance).to.equal(BigInt(2 * Math.pow(10, 17))); // 0,2 AE
}); 

 
  
  it('staker should be able to reduce his stake', async function () {

      console.log('Calling stub_reduce_stake');

  let call = await stakingContract.stub_get_stake(producer.address);
  let oldBalance = call.decodedResult;

  var callResult;
  try {
    callResult = await stakingContract.stub_reduce_stake(Math.pow(10, 17), {onAccount: producer}); // reduce by 0,1 AE
    console.log('Transaction ID:', callResult.hash);
    console.log('callResult.result.returnType:', callResult.result.returnType);
    console.log('Function call returned:', callResult.decodedResult);
  } catch (error) {
    console.log('Calling register_as_delegatee errored:', error);
    throw error;
  }

  let call2 = await stakingContract.stub_get_stake(producer.address);
  let newBalance = call2.decodedResult;

  //
  //wait for 4 seconds to let the nodes sync
  // await new Promise(resolve => setTimeout(resolve, 10000));

  // get how much was transfered to the withdrawer
  let call3 = await stakingContract.stub_debug_get_state()
  let state = call3.decodedResult;
  console.log(state);
  var lastWithdraw = state.debug_last_withdrawn_amount
  console.log("lastWithdraw:", lastWithdraw);


  console.log("oldBalance:", oldBalance);
  console.log("newBalance:", newBalance);
  // chai.expect(lastWithdraw).to.equal(BigInt(Math.pow(10,17))) && // 0,1 AE
  chai.expect(oldBalance - newBalance).to.equal(BigInt(Math.pow(10, 17))); // 0,1 AE
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

function logState(){
  return new Promise(async (resolve, reject) => {
    let state = await stakingContract.stub_debug_get_state();
    console.log("state:");
    console.dir(state.decodedResult, { depth: null, colors: true });
    resolve(true);
  });
}

});
