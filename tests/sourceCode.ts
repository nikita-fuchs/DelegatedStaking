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
  entrypoint withdraw : (int) => unit
  entrypoint adjust_stake : (int) => unit
  entrypoint get_current_epoch : () => int
  entrypoint get_validator_min_stake : () => int
  
contract interface MainStakingI =
  entrypoint new_validator : (address, address, bool) => StakingValidatorI
  entrypoint staking_power : (address) => int

payable contract StakingPoC =

    record state = {
        current_epoch_stub: int, // debugging and testing, not used.
        delegated_stakes: list(delegated_stake), // 
        max_delegators: int,
        min_delegation_duration: int, // min amount of epochs somebody has to have delegated to be eligible for rewards
        debug_last_withdrawn_amount: int, // debugging and testing, not used.
        main_staking_ct : MainStakingI,
        staking_validator_ct: StakingValidatorI,
        min_delegation_amount: int,
        total_queued_withdrawal_amount: int, // track how much value to hold back for requested withdrawals (from unstaking or rewards). not decided yet if needed, evaulating. currently set, but not read. evaluating with core.
        queued_withdrawals: map(address, list(pending_withdrawal)),
        max_withdrawal_queue_length : int,
        debug_last_cb_values: (int * int * bool)
        }

    
    record delegated_stake = {
        delegator: address,
        stake_amount: int,
        from_epoch : int,
        reward : int
        } 

    record pending_withdrawal = {
        amount: int,
        from_epoch: int
        }

    stateful entrypoint init(validator : address, main_staking_ct : MainStakingI, min_delegation_amount: int, max_delegators: int, min_delegation_duration: int, max_withdrawal_queue_length : int) =
      // call MainStaking to get a stakingValidator contract
      let staking_validator_ct = main_staking_ct.new_validator(Contract.address, validator, true, value = Contract.balance)
      // register callback
      staking_validator_ct.register_reward_callback(Address.to_contract(Contract.address))
      // get the validator_min_stake from MainStaking and... 
      let defined_min_stake = staking_validator_ct.get_validator_min_stake()
      //...check if the provided number suffices.
      require(min_delegation_amount >= defined_min_stake, String.concat("The provided min_delegation_amount is lower than the required minimal_stake in this hyperchains setup, ", Int.to_str(defined_min_stake)))
      // as per request, we allow requiring to stake longer than necessary.
      require(min_delegation_duration >= 5, "min_delegation_duration must be at least 5 epochs")


      { 
        current_epoch_stub = 1, // debugging and testing, not used.
        delegated_stakes = [],
        max_delegators = max_delegators, // proposing 30 for the start?
        min_delegation_duration = min_delegation_duration,
        debug_last_withdrawn_amount = 0, // debugging and testing, not used.
        main_staking_ct = main_staking_ct,
        staking_validator_ct = staking_validator_ct,
        min_delegation_amount = min_delegation_amount,
        total_queued_withdrawal_amount = 0,
        queued_withdrawals = {},
        max_withdrawal_queue_length = max_withdrawal_queue_length,
        debug_last_cb_values = (0,0,false)
       }

    
    
    payable stateful entrypoint delegate_stake() =
      require(Call.value >= get_minimum_stake_amount(), "Delegated funds do not suffice required minimum, aborting")
      require(List.length(state.delegated_stakes) =< state.max_delegators, "Allowed amount of delegators per staker exceeded") 
      
      let epoch = get_current_epoch() 
      let amount = Call.value
      let delegated_stakes = state.delegated_stakes
      let new_delegated_stake = {delegator = Call.caller, stake_amount = Call.value, from_epoch = get_current_epoch(), reward = 0}

      put(state{ delegated_stakes = delegated_stakes ++ [new_delegated_stake] }) 
      state.staking_validator_ct.stake(value = Call.value)



    public stateful entrypoint request_unstake_delegated_stakes(delegatee: address) =
        // get my stakes
        let (my_delegated_stakes, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, state.delegated_stakes)

        // calculate their total reward
        let total_rewards = List.foldl((reward_acc, delegated_stake) =>  
            let updated_reward = reward_acc + delegated_stake.reward 
            updated_reward, 
            0, 
            my_delegated_stakes)

        // calculate their total delegation amount
        let total_delegated = List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_delegated_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_delegated_stake, 
            0, 
            my_delegated_stakes)

        let total_payout = total_rewards + total_delegated 

        // remove these delegated stakes
        put(state{ delegated_stakes = others_delegated_stakes }) 
        
        // request the amount or add it to the withdrawal queue 
        withdraw_or_queue(Call.caller, total_payout)

    
    public stateful entrypoint request_withdraw_rewards() : string =
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
        
        // for testing
        put(state{debug_last_withdrawn_amount = total_rewards})
        require(total_rewards > 0, "No rewards available to withdraw yet")

        withdraw_or_queue(Call.caller, total_rewards)
        

    /*  
    * Called by the stakingValidator contract when the validator this contract corresponds to gets his reward for the past epoch. 
    * assigns every eligible delegator (if delegated long enough) a numerical reward. 
    */
    stateful payable entrypoint reward_cb(epoch: int, amount: int, restaked: bool) =
                    put(state{debug_last_cb_values = (epoch, amount, restaked)})
                    let all_delegations = state.delegated_stakes

                    let (all_eligible_delegators : list(delegated_stake), all_other_delegators) = List.partition((delegation) => 
                        (get_current_epoch() >= delegation.from_epoch + state.min_delegation_duration)
                            , all_delegations)
                    
                    // as base for calculation, include only thos who staked for long enough already.
                    let total_eligible_stake = get_total_eligible_stake_amount()

                    let all_eligible_delegators_with_updated_rewards : list(delegated_stake) = List.map((delegator) => 
                        let percentage_of_total_stake = Frac.make_frac(delegator.stake_amount, total_eligible_stake) 

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

    
    /* 
    * called to withdraw all queued up withdrawals which represent funds that be unstaked by now in the MainStaking and be available as part of the available balance by now. 
    */
    stateful entrypoint withdraw() =
    // 0 assert there are withdrawals
        let all_withdrawals = state.queued_withdrawals[Call.caller = []]
        require(List.length(all_withdrawals) > 0, "No queued withdrawals found for this user") // explicitly check, for UX/UI
    
        //1. get eligible withdrawals
        let (all_eligible_withdrawals, other_withdrawals) = separate_eligible_withdrawals(Call.caller)
        //2. calculate their amount
        let total_withdrawal = List.foldl((acc, eligible_withdrawal) => acc + eligible_withdrawal.amount, 0, all_eligible_withdrawals)

        //3. withdraw that amount from mainstaking
        state.staking_validator_ct.withdraw(total_withdrawal)

        //4. subtract it from the total locked amount
        put(state{total_queued_withdrawal_amount @ tot = tot - total_withdrawal})

        //5. put back only the non-eligible withdrawals into the user's state
        put(state{queued_withdrawals[Call.caller] = other_withdrawals})

        //6. transfer the amount to the user
        Chain.spend(Call.caller, total_withdrawal)


  // ------------------------------------------------------------------------
  // --   Helpers
  // ------------------------------------------------------------------------

    /* 
    * get withdrawals from user's queue which are (not) past their locking period - to be used in the UI also 
    */
    entrypoint separate_eligible_withdrawals(delegator: address) =
        let all_withdrawals = state.queued_withdrawals[delegator = []]
        let (all_eligible_withdrawals, other_withdrawals) = List.partition((queued_withdrawal) => 
                        (get_current_epoch() >= queued_withdrawal.from_epoch)
                            , all_withdrawals)
        (all_eligible_withdrawals, other_withdrawals)

    /* 
     * Withdraw from MainStaking (through stakingValidator) if possible, 
     * or trigger unlocking of funds in MainStaking (through stakingValidator) and put in withdrawal queue, so they can be later withdrawn. 
     */
    stateful function withdraw_or_queue(recipient: address, amount: int) =
         // if there is enough available balance in the main staking, withdraw and transfer directly. 
        if(state.staking_validator_ct.get_available_balance() >= amount)
            state.staking_validator_ct.withdraw(amount)
            //by here, the funds should be in this contract. pass them on.
            Chain.spend(Call.caller, amount)
            "SUCCESS" // helper for the frontend developer/tests. 
        
        // if there is not enough balance available: 
        else
        // 1.request unstake,
            state.staking_validator_ct.adjust_stake(-amount)
        // 2. process into withdrawal queue
            queue_for_withdrawal(Call.caller, amount, calc_unlock_epoch())
        // 3. and tell user to wait 5 epochs.
            String.concat("WAIT TILL EPOCH ", Int.to_str(get_current_epoch() + state.min_delegation_duration)) // helper for the frontend developer/tests. 
    
    /* 
    * Create a withdrawal in a list, which later can be processed, as soon as the corresponding value should be available in the main staking contract. 
    */
    stateful function queue_for_withdrawal(recipient: address, amount: int, epoch: int) =
    // prevent queue from getting too long
        require(List.length(state.queued_withdrawals[Call.caller = []]) =< state.max_withdrawal_queue_length, "Too many withdrawals in the queue for this account, withdraw eligible ones first.")
    // add withdrawal to user's queue
        let withdrawal : pending_withdrawal = {
            amount = amount,
            from_epoch = epoch
          }

        put(state{queued_withdrawals[recipient = []] @ existing = existing ++ [withdrawal]})

        // increase the total locked withdrawal
        put(state{total_queued_withdrawal_amount @ tot = tot + amount})

    function calc_unlock_epoch() =
        get_current_epoch() + 4

  // ------------------------------------------------------------------------
  // --   Getters 
  // ------------------------------------------------------------------------

    entrypoint get_current_epoch() =
        //state.current_epoch_stub
        state.staking_validator_ct.get_current_epoch()

    entrypoint get_available_balance() =
        state.staking_validator_ct.get_available_balance()

    entrypoint get_total_balance() =
        state.staking_validator_ct.get_total_balance()

    // get the total amount of delegated stake that has been staked for at least X epochs already
    public entrypoint get_total_eligible_stake_amount() =
        let (eligible, rest) = List.partition((delegation) => (get_current_epoch() >= delegation.from_epoch + state.min_delegation_duration), state.delegated_stakes)
        
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_eligible_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_eligible_stake, 
            0, 
            eligible)

    public entrypoint get_total_delegated_stake_amount() =
        let all_delegations = state.delegated_stakes
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_delegated_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_delegated_stake, 
            0, 
            all_delegations)
 
    public entrypoint get_minimum_stake_amount() : int =
        state.min_delegation_amount

    public entrypoint get_all_delegations() =
        state.delegated_stakes

    public entrypoint get_all_delegations_by_delegator(delegator: address) =
        let all_delegations = state.delegated_stakes
        switch(all_delegations) 
            [] => []
            all => find_in_delegations_by_delegator(all, delegator) 

    
    function find_in_delegations_by_delegator(delegations: list(delegated_stake), delegator: address) = 
        let found_delegations = List.filter((delegated) => delegated.delegator == delegator, delegations)
        found_delegations

    public entrypoint calculate_accumulated_rewards_per_delegator(delegator: address) =
        let found_delegations = get_all_delegations_by_delegator(delegator)
        List.foldl((acc, delegated_stake) => acc + delegated_stake.reward , 0 ,found_delegations)


  // ------------------------------------------------------------------------
  // --   DEBUGGING - not used !
  // ------------------------------------------------------------------------

    stateful entrypoint debug_set_epoch(epoch: int) =
        put(state{current_epoch_stub = epoch})
        state.current_epoch_stub

    public entrypoint debug_get_state() =
        state
        
    entrypoint staking_power() =
        state.main_staking_ct.staking_power(Contract.address)

    entrypoint debug_get_last_cb_values() =
        state.debug_last_cb_values

`

export default sourceCode;