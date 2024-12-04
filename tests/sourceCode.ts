const sourceCode =`
@compiler >= 6

include "String.aes"
include "List.aes"
include "Option.aes"
include "Frac.aes"

contract interface RewardCallbackI =
  entrypoint reward_cb : (int, int, bool) => unit

contract interface StakingValidatorI =
  entrypoint register_reward_callback : (RewardCallbackI) => unit
  entrypoint stake : () => unit
  entrypoint get_available_balance : () => int
  entrypoint get_total_balance : () => int

contract interface MainStakingI =
  entrypoint new_validator : (address, bool) => StakingValidatorI


payable contract StakingPoC =

    record state = {
        current_blockreward_stub : int, 
        current_epoch_stub: int, 
        delegated_stakes: list(delegated_stake), // 
        max_delegators: int,
        main_stakes_stub: map(address, int), // staking balances from existing staking logic
        min_delegation_duration: int, // min amount of epochs somebody has to have delegated to be eligible for rewards
        debug_last_withdrawn_amount: int,
        main_staking_ct : MainStakingI,
        staking_validator_ct: StakingValidatorI,
        min_delegation_amount: int
        }

    
    record delegated_stake = {
        delegator: address,
        stake_amount: int,
        from_epoch : int,
        reward : int
        } 

    stateful entrypoint init(validator: address, main_staking_ct : MainStakingI, min_delegation_amount: int, max_delegators: int) =
    // call MainStaking to get a stakingValidator contract
      let staking_validator_ct = main_staking_ct.new_validator(Contract.address, true)
      // register callback
      staking_validator_ct.register_reward_callback(Address.to_contract(Contract.address))

      { 
        current_epoch_stub = 1, 
        delegated_stakes = [],
        max_delegators = max_delegators, // proposing 30 for the start?
        current_blockreward_stub = 1 * (10 ^ 18), 
        main_stakes_stub = {},
        min_delegation_duration = 5,
        debug_last_withdrawn_amount = 0,
        main_staking_ct = main_staking_ct,
        staking_validator_ct = staking_validator_ct,
        min_delegation_amount = min_delegation_amount
       }

    
    
    payable stateful entrypoint delegate_stake() =
      require(Call.value >= get_minimum_stake_amount(), "Delegated funds do not suffice required minimum, aborting")
      require(List.length(state.delegated_stakes) =< state.max_delegators, "Allowed amount of delegators per staker exceeded") 
      
      let epoch = get_current_epoch() 
      let amount = Call.value
      let delegated_stakes = state.delegated_stakes
      let new_delegated_stake = {delegator = Call.caller, stake_amount = Call.value, from_epoch = stub_debug_get_epoch(), reward = 0}

      put(state{ delegated_stakes = delegated_stakes ++ [new_delegated_stake] }) 
      state.staking_validator_ct.stake(value = Call.value)


NEXT 
    public stateful entrypoint withdraw_delegated_stakes(delegatee: address) =
        let (my_delegated_stakes, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, state.delegated_stakes)


        let total_rewards = List.foldl((reward_acc, delegated_stake) =>  
            let updated_reward = reward_acc + delegated_stake.reward 
            updated_reward, 
            0, 
            my_delegated_stakes)


        let total_delegated = List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_delegated_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_delegated_stake, 
            0, 
            my_delegated_stakes)

        let total_payout = total_rewards + total_delegated 
        // remove the delegated stakes
        put(state{ delegated_stakes = others_delegated_stakes }) 
        Chain.spend(Call.caller, total_payout)

    
    public stateful entrypoint withdraw_rewards(delegatee: address) =
        let (my_delegated_stakes, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, state.delegated_stakes) 
        require(!List.is_empty(my_delegated_stakes), "No delegated stakes found for this account.") 

        let (total_rewards : int, updated_delegated_stakes : list(delegated_stake)) = List.foldl((reward_and_stakes_acc, old_delegated_stake) =>  
            
            let (reward, all_updated_stakes) = reward_and_stakes_acc
            let updated_reward = reward + old_delegated_stake.reward 
            let updated_stake : delegated_stake = {
                delegator = old_delegated_stake.delegator,
                stake_amount = old_delegated_stake.stake_amount,
                from_epoch = old_delegated_stake.from_epoch,
                reward = 0 
             } 
            
            (updated_reward, all_updated_stakes ++ [updated_stake]), 
            (0 , []), 
            my_delegated_stakes)

        put(state{delegated_stakes = others_delegated_stakes ++ updated_delegated_stakes}) 
        
        put(state{debug_last_withdrawn_amount = total_rewards})
        require(total_rewards > 0, "No rewards available to withdraw yet")
        Chain.spend(Call.caller, total_rewards) 

    // Called by the stakingValidator contract when the validator this contract corresponds to gets his reward for the past epoch. 
    // assigns every eligible delegator (if delegated long enough) a numerical reward.
    stateful payable entrypoint reward_cb(epoch: int, amount: int, restaked: bool) =
 
                    let all_delegations = state.delegated_stakes

                    let (all_eligible_delegators : list(delegated_stake), all_other_delegators) = List.partition((delegation) => 
                    // reward if either staked for long enough, or in any case, if it's the block producer.
                        (get_current_epoch() >= delegation.from_epoch + state.min_delegation_duration) || (delegation.delegator == Call.caller)
                            , all_delegations)
                    
                    let total_eligible_stake : int = get_total_eligible_stake_amount_by_delegatee(Call.caller)

                    let all_eligible_delegators_with_updated_rewards : list(delegated_stake) = List.map((delegator) => 
                        let percentage_of_total_stake = Frac.make_frac(delegator.stake_amount, total_eligible_stake) 

                        // option 1: have a hardcoded block reward (for testing or however the staking contract implements things)    
                        //let final_reward_frac = Frac.mul(percentage_of_total_stake, Frac.from_int(state.current_blockreward_stub))
                        
                        // option 2: take call.value as block reward
                        let final_reward_frac = Frac.mul(percentage_of_total_stake, Frac.from_int(amount))

                        let final_reward = Frac.floor(final_reward_frac)
                        
                        {
                                delegator = delegator.delegator,
                                stake_amount = delegator.stake_amount,
                                from_epoch = delegator.from_epoch,
                                reward = delegator.reward + final_reward 
                            }
                         ,all_eligible_delegators)

                    put(state{delegated_stakes = all_other_delegators ++ all_eligible_delegators_with_updated_rewards })

    
  // ------------------------------------------------------------------------
  // --   Getters
  // ------------------------------------------------------------------------

    entrypoint get_current_epoch() =
        state.current_epoch_stub

    // CRITICAL TODO: placeholder function that fetches the staking amount for a given delegatee (block producer)
    entrypoint get_available_balance() =
        state.staking_validator_ct.get_available_balance()

    entrypoint get_total_balance() =
        state.staking_validator_ct.get_total_balance()

    
    // get both delegators' stakes who are eligible for a reward already as well as the producer's/delegatee's stake, who is always eligible for a reward.
    public entrypoint get_total_eligible_stake_amount_by_delegatee(delegatee: address) =
        let (eligible, rest) = List.partition((delegation) => (get_current_epoch() >= delegation.from_epoch + state.min_delegation_duration) || delegation.delegator == Call.caller, state.delegated_stakes)
        
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_eligible_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_eligible_stake, 
            0, 
            eligible)

    public entrypoint get_total_stake_amount_by_delegatee() =
        let all_delegations = state.delegated_stakes
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_delegated_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_delegated_stake, 
            0, 
            all_delegations)
 
    public entrypoint get_minimum_stake_amount() : int =
        state.min_delegation_amount

    
  /*   public entrypoint get_all_delegations_by_delegatee(delegatee : address) : list(delegated_stake) =
        require(is_delegatee(delegatee), "Tried fetching delegated stakes from a non-delegatee.")
        Map.lookup_default(delegatee, state.delegated_stakes, []) */

    
    public entrypoint get_all_delegations_by_delegator(delegator: address) =
        let all_delegations = state.delegated_stakes
        switch(all_delegations) 
            [] => []
            all => find_in_delegations_by_delegator(all, delegator) 
      
        //Map.to_list(state.my_delegatees[Call.caller = []])

    
    function find_in_delegations_by_delegator(delegations: list(delegated_stake), delegator: address) = 
        let found_delegations = List.filter((delegated) => delegated.delegator == delegator, delegations)
        found_delegations

    // get your accumulated rewards 
    public entrypoint calculate_accumulated_rewards_per_delegator(delegator: address) =
        let found_delegations = get_all_delegations_by_delegator(delegator)
        List.foldl((acc, delegated_stake) => acc + delegated_stake.reward , 0 ,found_delegations)


    // get all accumulated rewards per delegatee
    public entrypoint calculate_accumulated_rewards() =

        let (my_delegated_stakes, others) = List.partition((delegation) => delegation.delegator == Call.caller, state.delegated_stakes)
        List.foldl((acc, delegated_stake) => acc + delegated_stake.stake_amount, 0, my_delegated_stakes)

    
    // TODO: Make internal function, calling stakingValidator !
    stateful entrypoint stub_unstake() =
        let stake = state.main_stakes_stub[Call.caller]
        
        // update amount in main staking balance
        put(state{main_stakes_stub[Call.caller] = 0})

        // update amount in staking bookkeeping
        update_delegatees_stake(0)
    
    entrypoint get_total_balance() =
        state.staking_validator_ct.get_total_balance()


  // ------------------------------------------------------------------------
  // --   DEBUGGING - put into MainStakingStub Contract
  // ------------------------------------------------------------------------

    stateful entrypoint stub_debug_set_epoch(epoch: int) =
        put(state{current_epoch_stub = epoch})
        state.current_epoch_stub

    public entrypoint stub_debug_get_epoch() =
        state.current_epoch_stub

    public entrypoint stub_debug_get_state() =
        state
`

export default sourceCode;