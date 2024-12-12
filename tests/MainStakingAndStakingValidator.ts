const mainStakingSource = `
include "List.aes"
include "Pair.aes"
include "Option.aes"

contract interface RewardCallbackI =
  entrypoint reward_cb : (int, int, bool) => unit

contract interface MainStakingI =
  payable entrypoint deposit          : () => unit
  payable entrypoint stake            : () => unit
  entrypoint adjust_stake             : (int) => unit
  entrypoint withdraw                 : (int) => unit
  entrypoint set_restake              : (bool) => unit
  entrypoint get_restake              : () => bool
  entrypoint get_staked_amount        : (int) => int
  entrypoint get_available_balance    : () => int
  entrypoint get_total_balance        : () => int
  entrypoint get_current_epoch        : () => int
  entrypoint register_reward_callback : (RewardCallbackI) => unit
  entrypoint get_validator_min_stake  : () => int

payable contract StakingValidator =
  record state =
    { main_staking_ct : MainStakingI,
      owner           : address,
      signing_key     : address,
      reward_callback : option(RewardCallbackI)
    }

  entrypoint init(main_staking_ct : MainStakingI, owner : address, signing_key : address) =
    { main_staking_ct = main_staking_ct,
      owner           = owner,
      signing_key     = signing_key,
      reward_callback = None }

  payable stateful entrypoint deposit() =
    require(Call.value > 0, "Deposit must be positive")
    assert_owner_caller()
    state.main_staking_ct.deposit(value = Call.value)

  payable stateful entrypoint stake() =
    require(Call.value > 0, "Stake must be positive")
    assert_owner_caller()
    state.main_staking_ct.stake(value = Call.value)

  stateful entrypoint adjust_stake(adjust_amount : int) =
    assert_owner_caller()
    state.main_staking_ct.adjust_stake(adjust_amount)

  stateful entrypoint withdraw(amount : int) =
    assert_owner_caller()
    state.main_staking_ct.withdraw(amount)
    Chain.spend(Call.caller, amount)

  entrypoint set_restake(restake : bool) =
    assert_owner_caller()
    state.main_staking_ct.set_restake(restake)

  entrypoint get_restake() : bool =
    state.main_staking_ct.get_restake()

  entrypoint get_staked_amount(epoch : int) =
    state.main_staking_ct.get_staked_amount(epoch)

  entrypoint get_available_balance() =
    state.main_staking_ct.get_available_balance()

  entrypoint get_total_balance() =
    state.main_staking_ct.get_total_balance()

  stateful entrypoint register_reward_callback(cb_ct : RewardCallbackI) =
    assert_owner_caller()
    put(state{reward_callback = Some(cb_ct)})

 /*  entrypoint rewards(epoch : int, amount : int, restaked : bool) =
    assert_main_staking_caller()
    switch(state.reward_callback)
      None => None
      Some(cb_ct) => 
        cb_ct.reward_cb(protected = true, gas = 20000, epoch, amount, restaked)
 */

  entrypoint rewards(epoch : int, amount : int, restaked : bool) =
    assert_main_staking_caller()
    switch(state.reward_callback)
      None => ()
      Some(cb_ct) => cb_ct.reward_cb(epoch, amount, restaked)


  entrypoint has_reward_callback() =
    Option.is_some(state.reward_callback)

  entrypoint get_current_epoch() =
    state.main_staking_ct.get_current_epoch()

  function assert_owner_caller() =
    require(Call.caller == state.owner, "Only contract owner allowed")

  function assert_main_staking_caller() =
    require(Call.caller == state.main_staking_ct.address, "Only main staking contract allowed")

  entrypoint get_validator_min_stake() =
    state.main_staking_ct.get_validator_min_stake()

  /// DEBUG:
  entrypoint get_state() =
    state

main contract MainStaking =
  record validator =
    { owner         : address,
      sign_key      : address,
      total_balance : int,
      current_stake : int,
      staked        : map(int, int),
      restake       : bool
    }

  record state =
    { validators          : map(address, validator),
      owners              : map(address, address),
      sign_keys           : map(address, address),
      validator_min_stake : int,
      current_epoch       : int
    }

  entrypoint init(validator_min_stake : int) =
    { validators = {},
      owners = {},
      sign_keys = {},
      validator_min_stake = validator_min_stake,
      // The first block is part of epoch 1
      current_epoch = 1 }

  payable stateful entrypoint new_validator(owner : address, sign_key : address, restake : bool) : StakingValidator =
    require(Call.value >= state.validator_min_stake, "A new validator must stake the minimum amount")
    require(!Map.member(owner, state.owners), "Owner must be unique")
    require(!Map.member(sign_key, state.sign_keys), "Sign key must be unique")
    let validator_ct = Chain.create(Address.to_contract(Contract.address), owner, sign_key) : StakingValidator
    let v_addr = validator_ct.address
    put(state{validators[v_addr] = {owner = owner, sign_key = sign_key,
                                    total_balance = 0, current_stake = 0,
                                    staked = {}, restake = restake},
              owners[owner] = v_addr,
              sign_keys[sign_key] = v_addr})
    stake_(v_addr, Call.value)
    validator_ct

  // ------------------------------------------------------------------------
  // -- StakingValidator API
  // ------------------------------------------------------------------------
  payable stateful entrypoint deposit() =
    require(Call.value > 0, "Deposit needs a positive value")
    assert_validator(Call.caller)
    deposit_(Call.caller, Call.value)

  payable stateful entrypoint stake() =
    require(Call.value > 0, "Stake needs a positive value")
    assert_validator(Call.caller)
    stake_(Call.caller, Call.value)

  stateful entrypoint adjust_stake(amount : int) =
    assert_validator(Call.caller)
    adjust_stake_(Call.caller, amount)

  stateful entrypoint withdraw(amount) =
    assert_validator(Call.caller)
    let available = get_available_balance_(Call.caller)
    require(available >= amount, "Too large withdrawal")

    withdraw_(Call.caller, amount)
    Chain.spend(Call.caller, amount)

  stateful entrypoint set_restake(restake : bool) =
    assert_validator(Call.caller)
    put(state{validators[Call.caller] @ v = v{restake = restake}})

  entrypoint get_restake() : bool =
    state.validators[Call.caller].restake

  entrypoint get_staked_amount(epoch : int) =
    get_staked_amount_(Call.caller, epoch)

  entrypoint get_available_balance() =
    get_available_balance_(Call.caller)

  entrypoint get_available_balance_(validator : address) : int =
    let v = state.validators[validator]
    v.total_balance - locked_stake(v)

  entrypoint get_total_balance() =
    get_total_balance_(Call.caller)

  entrypoint get_total_balance_(v : address) =
    state.validators[v].total_balance

  entrypoint get_validator_min_stake() =
    state.validator_min_stake

  // ------------------------------------------------------------------------
  // -- Called from HCElection and/or consensus logic
  // ------------------------------------------------------------------------
  payable stateful entrypoint add_rewards(epoch : int, rewards : list(address * int)) =
    //assert_protocol_call()
    let total_rewards = List.foldl((+), 0, List.map(Pair.snd, rewards))
    require(total_rewards == Call.value, "Incorrect total reward given")
    List.foreach(rewards, (r) => add_reward(epoch, r))
    [ unlock_stake_(v_addr, validator, epoch) | (v_addr, validator) <- Map.to_list(state.validators) ]
    // At the end of epoch X we distribute rewards for X - 1; thus current_epoch
    // is (soon) X + 1. I.e. X - 1 + 2.
    put(state{current_epoch = epoch + 2})

  stateful entrypoint lock_stake(epoch : int) : list(address * int) =
    assert_protocol_call()
    [ lock_stake_(v_addr, validator, epoch) | (v_addr, validator) <- Map.to_list(state.validators) ]
    sorted_validators()

  entrypoint sorted_validators() : list(address * int) =
    let vs = [ (sk, s) | (_, {sign_key = sk, current_stake = s}) <- Map.to_list(state.validators),
                         if(s >= state.validator_min_stake) ]

    List.sort(cmp_validator, vs)

  // ------------------------------------------------------------------------
  // -- Lookup API
  // ------------------------------------------------------------------------
  entrypoint staking_power(owner : address) =
    let v = lookup_validator(owner)
    v.current_stake

  entrypoint get_validator_state(owner : address) =
    lookup_validator(owner)

  entrypoint get_validator_contract(owner : address) : StakingValidator =
    assert_owner(owner)
    Address.to_contract(state.owners[owner])

  entrypoint get_current_epoch() =
    state.current_epoch
  // ------------------------------------------------------------------------
  // --   Testing / Debugging
  // ------------------------------------------------------------------------

  stateful entrypoint debug_adjust_epoch_by(new_epoch : int) =
    put(state{current_epoch = state.current_epoch + new_epoch})
    state.current_epoch

  stateful entrypoint debug_set_epoch_to(new_epoch : int) =
    put(state{current_epoch = new_epoch})
    state.current_epoch



  // ------------------------------------------------------------------------
  // --   Internal functions
  // ------------------------------------------------------------------------
  function cmp_validator((x_addr : address, x_stake : int), (y_addr : address, y_stake : int)) =
    if (x_stake == y_stake) x_addr < y_addr else x_stake > y_stake

  function lookup_validator(owner : address) =
    assert_owner(owner)
    state.validators[state.owners[owner]]

  stateful function add_reward(epoch : int, (sign_key, amount) : address * int) =
    assert_signer(sign_key)
    let validator = state.sign_keys[sign_key]
    let restake = state.validators[validator].restake
    if(restake)
      stake_(validator, amount)
    else
      deposit_(validator, amount)
    let validator_ct = Address.to_contract(validator) : StakingValidator
    validator_ct.rewards(epoch, amount, restake)

  stateful function lock_stake_(v_addr : address, validator : validator, epoch : int) : unit =
    if(validator.current_stake >= state.validator_min_stake)
      put(state{validators[v_addr] = validator{staked @ s = s{[epoch] = validator.current_stake}}})

  stateful function unlock_stake_(v_addr : address, validator : validator, epoch : int) : unit =
    put(state{validators[v_addr] = validator{staked @ s = Map.delete(epoch, s)}})

  stateful function deposit_(validator : address, amount : int) =
    put(state{validators[validator] @ v = deposit_v(v, amount)})

  stateful function stake_(validator : address, amount : int) =
    put(state{validators[validator] @ v = stake_v(v, amount)})

  stateful function withdraw_(validator : address, amount : int) =
    put(state{validators[validator] @ v = withdraw_v(v, amount)})

  function get_staked_amount_(validator : address, epoch : int) =
    Map.lookup_default(epoch, state.validators[validator].staked, 0)

  stateful function adjust_stake_(validator : address, amount : int) =
    put(state{validators[validator] @ v = adjust_stake_v(v, amount)})

  function deposit_v(v : validator, amount) =
    v{total_balance @ tb = tb + amount}

  function stake_v(v : validator, amount) =
    v{total_balance @ tb = tb + amount,
      current_stake @ cs = cs + amount}

  function withdraw_v(v : validator, amount) =
    v{total_balance @ tb = tb - amount}

  function adjust_stake_v(v : validator, amount) =
    require(v.total_balance >= v.current_stake + amount, "Too large stake")
    require(0 =< v.current_stake + amount, "Too small stake")
    v{current_stake @ cs = cs + amount}

  function locked_stake(v : validator) =
    let stakes = List.map(Pair.snd, Map.to_list(v.staked))
    max(stakes)

  function max(ls : list(int)) : int =
    List.foldl((a, b) => if(a > b) a else b, 0, ls)

  function assert_validator(v : address) =
    require(Map.member(v, state.validators), "Not a registered validator")

  function assert_owner(o : address) =
    require(Map.member(o, state.owners), "Not a registered validator owner")

  function assert_signer(s : address) =
    require(Map.member(s, state.sign_keys), "Not a registered sign key")

  function assert_protocol_call() =
    require(Call.origin == Contract.creator, "Must be called by the protocol")

  entrypoint get_state() =
    state

`

export default mainStakingSource