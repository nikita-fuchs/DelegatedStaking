import { describe } from "mocha";
import  * as chai from 'chai';
import { AeSdk, MemoryAccount, Node, CompilerHttp, Contract, getBalance, AE_AMOUNT_FORMATS } from '@aeternity/aepp-sdk';
import sourceCode from './sourceCode.ts';
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

await aeSdk.spend(500, producer.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE});  //0.5 AE
await aeSdk.spend(350, delegator.address, {onAccount: fundSource, denomination: AE_AMOUNT_FORMATS.MILI_AE}); //0.35 AE

var stakingContract

describe('Simple roundtrip:', function () {

  beforeEach(async function () {
    console.log('Waiting to prevent nonce issue...');
    // wait for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  it('should set up the sdk and connect to AE', async function () {
    const height = await aeSdk.getHeight();
    console.log('Connected to Mainnet Node! Current Block:', height);
    chai.expect(height).to.be.a('number');
  });

  it('Should deploy the contract', async function () {

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
      deployInfo = await stakingContract.init({onAccount: fundSource});
    } catch (error) {
      console.log('Something went wrong, did you set up the SDK properly?');
      console.log('Deployment failed:');
      throw error;
    }
    console.log('Contract deployed successfully!');
    console.log('Contract address:', stakingContract!.$options!.address);
    //@ts-ignore
    console.log('Transaction ID:', deployInfo.transaction);


    chai.expect(stakingContract!.$options!.address!.startsWith("ct_")).to.eql(true);
  });

  it('should be able to stake', async function () {
    console.log('Calling stub_stake');

    var callResult;
    try {
      callResult = await stakingContract.stub_stake({amount: Math.pow(10, 17), onAccount: producer}); // 0,1 AE
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

  it('should register Staker as delegatee', async function () {
      console.log('Calling register_as_delegatee');

      var callResult;
      try {
        callResult = await stakingContract.register_as_delegatee({onAccount: producer});
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

  it('should delegate stake to delegatee', async function () {

      const minStake = await stakingContract.get_minimum_stake_amount(producer.address);
      console.log("minimum stake amount:", minStake.decodedResult);

      // call function
      console.log('Calling delegate_stake');
      var callResult;
      try {
        callResult = await stakingContract.delegate_stake(producer.address, {amount: Math.pow(10, 17), onAccount: delegator}); //0.1 AE
        console.log('Transaction ID:', callResult.hash);
        console.log('Function call returned:', callResult.decodedResult);
      } catch (error) {
        console.log('Calling delegate_stake errored:', error);
        throw error;
      }

      chai.expect(callResult!.result.returnType).to.equal('ok');
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


  //WIP

 /* 
  it('should not withdraw anything a second time / if you don`t have any rewards to withdraw', async function () {
 });  */

 /* 

it('staker should be able to increase his stake', function () {
 chai.expect(false).to.be.a('boolean');
}); 
*/
    /* 
  
  it('staker should be able to reduce his stake', function () {
    chai.expect(false).to.be.a('boolean');
  }); 
  */
    /* 
  
  it('payouts should happen correctly after staker adjusts his stake', function () {
    chai.expect(false).to.be.a('boolean');
  }); 
  */


});
