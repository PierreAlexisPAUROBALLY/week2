const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')
const config = require('../config')
const { generate } = require('../src/0_generateAddresses')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('TornadoPool', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const l1Token = await deploy('WETH', 'Wrapped ETH', 'WETH')
    await l1Token.deposit({ value: utils.parseEther('3') })

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    // deploy L1Unwrapper with CREATE2
    const singletonFactory = await ethers.getContractAt('SingletonFactory', config.singletonFactory)

    let customConfig = Object.assign({}, config)
    customConfig.omniBridge = omniBridge.address
    customConfig.weth = l1Token.address
    customConfig.multisig = multisig.address
    const contracts = await generate(customConfig)
    await singletonFactory.deploy(contracts.unwrapperContract.bytecode, config.salt)
    const l1Unwrapper = await ethers.getContractAt('L1Unwrapper', contracts.unwrapperContract.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(MAXIMUM_DEPOSIT_AMOUNT)
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig, l1Unwrapper, sender, l1Token }
  }

  it('alice deposits L1 withdraw L2', async () => {
    const {tornadoPool,token, omniBridge } = await loadFixture(fixture)
    
    const aliceKeyPair = new Keypair()
    const aliceDepositAmount = utils.parseEther("0.1")
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeyPair })


    const { args, extData } = await prepareTransaction({tornadoPool,outputs: [aliceDepositUtxo],})
    const onTokenBridgedData = encodeDataForBridge({proof: args,extData,})

    const onTokenBridgeTx = await tornadoPool.populateTransaction.onTokenBridged(token.address, aliceDepositUtxo.amount, onTokenBridgedData)

    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgeTx.data }, // call onTokenBridgedTx
    ])

    const withdrawAmount=utils.parseEther('0.08')
    const withdrawAdress='0xDeaD00000000000000000000000000000000BEEf'
    const withdrawUtxo= new Utxo({amount:aliceDepositAmount.sub(withdrawAmount),keypair:aliceKeyPair})
    await transaction({
      tornadoPool,inputs:[aliceDepositUtxo],outputs:[withdrawUtxo],recipient:withdrawAdress
    })
    const recipientBalance= await token.balanceOf(withdrawAdress) // withrew 0.08
    expect(recipientBalance).to.be.equal(withdrawAmount)

    const omniBridgeBalance = await token.balanceOf(omniBridge.address) // on L2 nothing on bridge
    expect(omniBridgeBalance).to.be.equal(0)

    const TornadoPoolBalance = await token.balanceOf(tornadoPool.address) // the not withdrew stuff left in the liquiditypool
    expect (TornadoPoolBalance).to.be.equal(withdrawUtxo.amount)


  })

  it('A deposit send to B, B withdraw A withdraw',async() =>{
    const {tornadoPool,token, omniBridge } = await loadFixture(fixture)
    
    const aliceKeyPair = new Keypair()
    const aliceDepositAmount = utils.parseEther('0.13')
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositAmount, keypair: aliceKeyPair })

    const { args, extData } = await prepareTransaction({tornadoPool,outputs: [aliceDepositUtxo],})
    const onTokenBridgedData = encodeDataForBridge({proof: args,extData,})

    const onTokenBridgeTx = await tornadoPool.populateTransaction.onTokenBridged(token.address, aliceDepositUtxo.amount, onTokenBridgedData)

    await token.transfer(omniBridge.address, aliceDepositAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgeTx.data }, // call onTokenBridgedTx
    ])

    // Bob gives Alice address to send some eth inside the shielded pool
    const bobKeypair = new Keypair() // contains private and public keys
    const bobAddress = bobKeypair.address() // contains only public key

    // Alice sends some funds to Bob in L2
    const bobSendAmount = utils.parseEther('0.06')
    const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(bobSendAmount),
      keypair: aliceDepositUtxo.keypair,
    })

    await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] })

    // bob withdraw in L2
    // Bob parses chain to detect incoming funds
    const filter = tornadoPool.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await tornadoPool.queryFilter(filter, fromBlock.number)
    let bobReceiveUtxo
    try {
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
    } catch (e) {
      // we try to decrypt another output here because it shuffles outputs before sending to blockchain
      bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
    }


    const bobWithdrawUtxo= new Utxo ({amount: 0,keypair:bobKeypair})// bob want to withdraw all
    const bobWithdrawAddress='0x0DB143eDe6805F23922535Bad7Acb3e9Aa5D2F7b'
    await transaction({
      tornadoPool,inputs:[bobReceiveUtxo],outputs:[bobWithdrawUtxo],recipient:bobWithdrawAddress
    })// the balance on bobWithdrawAddress should be 0.06

    // Alice withdraws in L1
    const aliceWithdrawAddress='0x1D59B58B9Ba1CB87c40024e92e341C15cC5ce2F0'
    const aliceWithdrawUtxo=new Utxo({amount : 0,keypair:aliceKeyPair})// alice want to withdraw all
    await transaction({tornadoPool,inputs:[aliceChangeUtxo],outputs:[aliceWithdrawUtxo],recipient:aliceWithdrawAddress,isL1Withdrawal:true,})
    // the balance of the address shgould be 0 , the address of the omibridge sgould be 0.13-0.06


    const bobBalance= await token.balanceOf(bobWithdrawAddress) // withrew 0.08 on L2
    expect(bobBalance).to.be.equal(bobReceiveUtxo.amount)

    const aliceBalance = await token.balanceOf(aliceWithdrawAddress) // withdrew on L1 nothing left here
    expect(aliceBalance).to.be.equal(0)


    const omniBridgeBalance = await token.balanceOf(omniBridge.address) 
    expect(omniBridgeBalance).to.be.equal(aliceChangeUtxo.amount) // on bridge there should be residual alice balance (0.13-0.06)
    expect(omniBridgeBalance).to.be.equal(utils.parseEther('0.07'))

    const TornadoPoolBalance = await token.balanceOf(tornadoPool.address) // nothing left in so should be 0
    expect (TornadoPoolBalance).to.be.equal(0)










  })

})

