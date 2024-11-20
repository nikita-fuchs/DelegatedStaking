const sourceCode =`

@compiler >= 6

include "String.aes"
include "List.aes"
include "Option.aes"
include "Frac.aes"

contract interface MainStaking =
  entrypoint sorted_validators : () => list((address * int))


contract StakingPoC =

    record state = {
        current_blockreward_stub : int, 
        current_epoch_stub: int, 
        delegatees : list(address), 
        my_delegatees : map(address, map(address, bool)), // all the delegatees/stakers a user has delegated to.
        delegated_stakes: map(address, list(delegated_stake)), 
        minimum_delegation_threshold: int, // minimum percentage of the staker's amount you need to delegate
        maximum_delegators_per_staker: int,
        main_stakes_stub: map(address, int), // staking balances from existing staking logic
        minimum_delegation_duration: int, // min amount of epochs somebody has to have delegated to be eligible for rewards
        debug_last_withdrawn_amount: int
        }

    
    record delegated_stake = {
        delegator: address,
        stake_amount: int,
        from_epoch : int,
        reward : int
        } 

    stateful entrypoint init() =
      { 
        current_epoch_stub = 1, 
        delegatees = [],
        delegated_stakes = {},
        minimum_delegation_threshold = 1,
        maximum_delegators_per_staker = 30,
        current_blockreward_stub = 1 * (10 ^ 18), 
        my_delegatees = {},
        main_stakes_stub = {},
        minimum_delegation_duration = 5,
        debug_last_withdrawn_amount = 0
       }

    
    stateful entrypoint register_as_delegatee() =
      

      let stake = stub_get_staking_amount(Call.caller) 
      require(stake > 0, "No staked funds found for this account") 
      require(!is_delegatee(Call.caller), "Already registerted as delegatee") 
      
      let epoch = get_current_epoch()
      let own_stake = {delegator = Call.caller, stake_amount = stake, from_epoch = 1, reward = 0} 

      put(state{delegatees = state.delegatees ++ [Call.caller]}) 
      put(state{delegated_stakes[Call.caller = []] @ delegations = delegations ++ [own_stake] }) 


    
    
    payable stateful entrypoint delegate_stake(delegatee: address) =
      require(is_delegatee(delegatee), "Provided address is not a known staker") 
      require(Call.caller != delegatee , "Cannot delegate stake to own stake") 
      require(state.main_stakes_stub[delegatee] >= 100, "Delegatee's staked amount is below 100 aettos") // Required, so minimum delegation amount can be 1% of staked value = 1 aetto.
      require(Call.value >= get_minimum_stake_amount(delegatee), "Delegated funds do not suffice required minimum, aborting")
      require(List.length(state.delegated_stakes[delegatee]) < state.maximum_delegators_per_staker, "Allowed amount of delegators per staker exceeded") 
      
      
      let epoch = get_current_epoch() 
      let amount = Call.value
      let delegated_stakes = state.delegated_stakes[delegatee]
      let new_delegated_stake = {delegator = Call.caller, stake_amount = Call.value, from_epoch = 1, reward = 0}

      switch(Map.member(Call.caller, state.my_delegatees))         
         false => put( state{ my_delegatees[Call.caller] = { [delegatee] = true } })
         true => put(state{my_delegatees[Call.caller][delegatee] = true})

      put(state{ 
                 delegated_stakes[delegatee = []] @ delegated = delegated ++ [new_delegated_stake] }  ) 


    
    public stateful entrypoint withdraw_delegated_stake(delegatee: address) =
        require(is_delegatee(delegatee), "Provided account is not a delegatee.")
        let (my_delegated_stakes, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, get_all_delegations_by_delegatee(delegatee)) 


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

          
        put(state{delegated_stakes[delegatee] = others_delegated_stakes,     
                  my_delegatees[Call.caller] = Map.delete(delegatee, state.my_delegatees[Call.caller])}) 

        Chain.spend(Call.caller, total_payout)
    
        


    
    public stateful entrypoint withdraw_rewards(delegatee: address) =
        let (my_delegated_stakes, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, get_all_delegations_by_delegatee(delegatee)) 
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

        put(state{delegated_stakes[delegatee] = others_delegated_stakes ++ updated_delegated_stakes}) 
        
        put(state{debug_last_withdrawn_amount = total_rewards})
        Chain.spend(Call.caller, total_rewards) 

    // CRITICAL TODO: Called in the step() function. assigns every eligible delegator ( if delegated long enough) and the Call.caller (always) a reward.
    // I guess here you would add assert_protocol_call() , if I understood its role correctly.
    stateful payable entrypoint split_reward_to_delegators() =
        switch(is_delegatee(Call.caller))
            false => () 
            true => 
                    
                    let all_delegations = get_all_delegations_by_delegatee(Call.caller)

                    let (all_eligible_delegators : list(delegated_stake), all_other_delegators) = List.partition((delegation) => 
                    // reward if either staked for long enough, or in any case, if it's the block producer.
                        (get_current_epoch() >= delegation.from_epoch + state.minimum_delegation_duration) || (delegation.delegator == Call.caller)
                            , all_delegations)
                    
                    let total_eligible_stake : int = get_total_eligible_stake_amount_by_delegatee(Call.caller)

                    let all_eligible_delegators_with_updated_rewards : list(delegated_stake) = List.map((delegator) => 
                        let percentage_of_total_stake = Frac.make_frac(delegator.stake_amount, total_eligible_stake) 

                        // option 1: have a hardcoded block reward (for testing or however the staking contract implements things)    
                        //let final_reward_frac = Frac.mul(percentage_of_total_stake, Frac.from_int(state.current_blockreward_stub))
                        
                        // option 2: take call.value as block reward
                        let final_reward_frac = Frac.mul(percentage_of_total_stake, Frac.from_int(Call.value))

                        let final_reward = Frac.floor(final_reward_frac)
                        
                        {
                                delegator = delegator.delegator,
                                stake_amount = delegator.stake_amount,
                                from_epoch = delegator.from_epoch,
                                reward = delegator.reward + final_reward 
                            }
                         ,all_eligible_delegators)

                    put(state{delegated_stakes[Call.caller] = all_other_delegators ++ all_eligible_delegators_with_updated_rewards })
                    
 

    // for setting the correct delegatees staking amount in the delegations' bookkeeping
    stateful function update_delegatees_stake(new_value: int, delegatee: address) =
        require(is_delegatee(delegatee), "Tried updating a non-delegatee's stake")
        let (delegatees_stake, others_delegated_stakes) = List.partition((delegation) => delegation.delegator == Call.caller, get_all_delegations_by_delegatee(delegatee)) 
        require(!List.is_empty(delegatees_stake), "No stake found for the delegatee in the delegated stakes list. at this point in code, this should never happen.")
        let old_stake = List.get(0, delegatees_stake)

        let updated_stake = {
            delegator = old_stake.delegator,
            stake_amount = new_value,
            from_epoch = old_stake.from_epoch,
            reward = old_stake.reward
         }
        
        put (state{delegated_stakes[delegatee] = others_delegated_stakes ++ [updated_stake]})
    

    function get_current_epoch() =
        state.current_epoch_stub

    function is_delegatee(maybe_delegatee: address) =
        List.contains(maybe_delegatee, state.delegatees)

    // CRITICAL TODO: placeholder function that fetches the staking amount for a given delegatee (block producer)
    function stub_get_staking_amount(potential_staker: address) : int =
        //1 * (10 ^ 18) 
        Map.lookup_default(potential_staker, state.main_stakes_stub, 0)
    
    // get both delegators' stakes who are eligible for a reward already as well as the producer's/delegatee's stake, who is always eligible for a reward.
    public entrypoint get_total_eligible_stake_amount_by_delegatee(delegatee: address) =
        let (eligible, rest) = List.partition((delegation) => (get_current_epoch() >= delegation.from_epoch + state.minimum_delegation_duration) || delegation.delegator == Call.caller, get_all_delegations_by_delegatee(delegatee))
        
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_eligible_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_eligible_stake, 
            0, 
            eligible)

    public entrypoint get_total_stake_amount_by_delegatee(delegatee: address) =
        let all_delegations = get_all_delegations_by_delegatee(delegatee)
        List.foldl((stake_acc, delegated_stake) =>  
            let updated_total_delegated_stake = stake_acc + delegated_stake.stake_amount 
            updated_total_delegated_stake, 
            0, 
            all_delegations)

    
    public entrypoint get_all_delegatees_by_delegator(delegator: address) =
        state.my_delegatees[delegator] 

    
    public entrypoint get_minimum_stake_amount(delegatee: address) : int =

        require(is_delegatee(delegatee), "Tried checking stake amount for a non-delegatee")
        let staked_amount = stub_get_staking_amount(delegatee) 
        (staked_amount / 100) * state.minimum_delegation_threshold 

    
    public entrypoint get_all_delegations_by_delegatee(delegatee : address) : list(delegated_stake) =
        require(is_delegatee(delegatee), "Tried fetching delegated stakes from a non-delegatee.")
        Map.lookup_default(delegatee, state.delegated_stakes, [])

    
    public entrypoint get_all_delegations_by_delegatee_and_delegator(delegatee: address, delegator: address) =
        let all_delegations = get_all_delegations_by_delegatee(delegatee)
        switch(all_delegations) 
            [] => []
            all => find_in_delegations_by_delegator(all, delegator) 

    public entrypoint get_all_my_delegatees() =
        switch (Map.lookup(Call.caller, state.my_delegatees))
            None => {}
            Some(mine) => mine

      
        //Map.to_list(state.my_delegatees[Call.caller = []])

    
    function find_in_delegations_by_delegator(delegations: list(delegated_stake), delegator: address) = 
        let found_delegations = List.filter((delegated) => delegated.delegator == delegator, delegations)
        found_delegations

    // get your accumulated rewards for one delegatee
    public entrypoint calculate_accumulated_rewards_per_delegatee_per_delegator(delegatee: address, delegator: address) =
        let found_delegations = get_all_delegations_by_delegatee_and_delegator(delegatee, delegator)
        List.foldl((acc, delegated_stake) => acc + delegated_stake.reward , 0 ,found_delegations)


    // get all accumulated rewards per delegatee
    public entrypoint calculate_accumulated_rewards_per_delegatee(delegatee: address) =
        require(is_delegatee(delegatee), "Address provided is not a delegatee")

        let (my_delegated_stakes, others) = List.partition((delegation) => delegation.delegator == Call.caller, get_all_delegations_by_delegatee(delegatee))
        List.foldl((acc, delegated_stake) => acc + delegated_stake.stake_amount , 0 ,my_delegated_stakes)

    // CRITICAL TODO: If somebody stakes or increases his stake amount, here is how it would be handled in the delegation logic
    stateful payable entrypoint stub_stake() = 
        // if the staker is already a registered delegatee ( = he accepts delegated stake), add it to his stake in the delegation bookkeeping.
        switch (is_delegatee(Call.caller))
            false => ()
            true => 
            // find the delegatee's stake in the bookkeeping by abusing the fact that he is in the list of delegators, too
                let newStakedAmount = state.main_stakes_stub[Call.caller] + Call.value
                update_delegatees_stake(newStakedAmount, Call.caller)
                
        // and either way, update the staked amount in the main contract logic
        put(state{main_stakes_stub[Call.caller] = Call.value})
    
    
    //CRITICAL TODO: In case the staker reduced the amount, here is how it would handled with this delegation logic.
    stateful entrypoint stub_reduce_stake(reduce: int) =
        require(Map.lookup_default(Call.caller, state.main_stakes_stub, 0) > 0, "Trying to withdraw more than was staked")

        let newStakedAmount = state.main_stakes_stub[Call.caller] - reduce

        // change the amount in the delegation book keeping
        update_delegatees_stake(newStakedAmount, Call.caller)

        // update the amount 
        put(state{main_stakes_stub[Call.caller] @ stake = stake - reduce})

        // send the reduced amount 
        Chain.spend(Call.caller, reduce)

    stateful entrypoint stub_unstake() =
        let stake = state.main_stakes_stub[Call.caller]
        
        // update amount in main staking balance
        put(state{main_stakes_stub[Call.caller] = 0})

        // update amount in staking bookkeeping
        update_delegatees_stake(0, Call.caller)


    //
    stateful entrypoint stub_debug_set_epoch(epoch: int) =
        put(state{current_epoch_stub = epoch})
        state.current_epoch_stub

    public entrypoint stub_debug_get_epoch() =
        state.current_epoch_stub

    public entrypoint stub_debug_get_state() =
        state
        
`

export default sourceCode;