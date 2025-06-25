import { Blockchain, internal, SandboxContract, setGlobalVersion, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano, Dictionary, storeStateInit, loadStateInit, SendMode, ExtraCurrency, external, ExternalAddress } from '@ton/core';
import { InMsgParams, parseEc, Version11 } from '../wrappers/Version11';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { findTransactionRequired } from '@ton/test-utils';
import { getRandomInt, storageCollected } from './utils';

describe('Version11', () => {
    let code: Cell;

    let blockchain: Blockchain;

    let deployer: SandboxContract<TreasuryContract>;
    let version11: SandboxContract<Version11>;

    const requiredVersion = 11;

    beforeAll(async () => {
        code = await compile('Version11');
        blockchain = await Blockchain.create();

        blockchain.now = 100;

        blockchain.setConfig(setGlobalVersion(blockchain.config, 11));

        deployer = await blockchain.treasury('deployer');

        version11 = blockchain.openContract(Version11.createFromConfig({}, code));

        const res = await version11.sendDeploy(deployer.getSender(), toNano('100'));
        expect(res.transactions).toHaveTransaction({
            on: version11.address,
            deploy: true,
            aborted: false
        });
    });


    it('should deploy', async () => {});

    it('should reflect basic message correctly', async () => {
        const sendValue = BigInt(getRandomInt(1, 100)) * toNano('1');
        const res = await version11.sendTestInmsgParams(deployer.getSender(), InMsgParams.all, sendValue);

        const deployTx = findTransactionRequired(res.transactions, {
            on: version11.address,
            op: InMsgParams.all,
            aborted: false,
            outMessagesCount: 1
        });

        const inMsg = deployTx.inMessage!;
        if(inMsg.info.type !== 'internal') {
            throw new Error("No way");
        }

        expect(res.transactions).toHaveTransaction({
            from: version11.address,
            to: deployer.address,
            
            body: beginCell()
                    .storeUint(42, 32)
                    .storeUint(0, 64)
                    .storeBit(true)
                    .storeBit(false)
                    .storeAddress(deployer.address)
                    .storeCoins(inMsg.info.forwardFee)
                    .storeUint(inMsg.info.createdLt, 64)
                    .storeUint(inMsg.info.createdAt, 32)
                    .storeRef(beginCell().storeCoins(sendValue).storeCoins(sendValue).storeMaybeRef(null).endCell())
                    .storeMaybeRef(null)
                  .endCell()
        });
    });
    it('should reflect expected external message values', async () => {
        // Thing is that external with state init is only accepted if init hash
        // matches the account hash

        // In fact externall can have src address, and it should be respected
        const extAddr = new ExternalAddress(BigInt(getRandomInt(1, 100000)), 64);
        for(let mode of [InMsgParams.all, InMsgParams.state_init]) {
            const res = await blockchain.sendMessage({
                info: {
                    type: 'external-in',
                    src: extAddr,
                    dest: version11.address,
                    importFee: 0n
                },
                init: version11.init,
                body: Version11.testMsgExternal(mode, deployer.address)
            });

            /*
            const res = await blockchain.sendMessage(external({
                to: version11.address,
                body: Version11.testMsgExternal(mode, deployer.address),
                init: version11.init
            }));
            */

            const outputTx = findTransactionRequired(res.transactions,{
                on: deployer.address,
                from: version11.address,
                inMessageBounced: false,
            });

            const reportMsg = outputTx.inMessage!;
            if(reportMsg.info.type !== 'internal') {
                throw new Error("No way!");
            }

            const ds = reportMsg.body.beginParse().skip(64 + 32);

            if(mode == InMsgParams.all) {
                // Check all parameters match expected
                expect(ds.loadBit()).toBe(false);
                expect(ds.loadBit()).toBe(false);
                expect(ds.loadAddressAny()!.toString()).toEqual(extAddr.toString());
                expect(ds.loadCoins()).toBe(0n);
                expect(ds.loadUintBig(64)).toBe(0n);
                expect(ds.loadUintBig(32)).toBe(0n);

                // Value related fields
                const vs = ds.loadRef().beginParse();

                expect(vs.loadCoins()).toBe(0n);
                expect(vs.loadCoins()).toBe(0n);
                expect(vs.loadMaybeRef()).toBeNull();

                const stateInitCell = ds.loadMaybeRef()!;
                expect(stateInitCell).not.toBeNull();

                const parsedState = loadStateInit(stateInitCell?.beginParse());

                expect(parsedState.code).toEqualCell(version11.init!.code);
                expect(parsedState.data).toEqualCell(version11.init!.data);
            }
        }
    });

    it('should reflect expected values in get-method scenario', async () => {

        let ds = (await version11.getInMsgParamsRaw(InMsgParams.all)).beginParse();

        // Check all parameters match expected
        expect(ds.loadBit()).toBe(false);
        expect(ds.loadBit()).toBe(false);
        expect(ds.loadUint(2)).toBe(0); // Explicit addr_none
        expect(ds.loadCoins()).toBe(0n);
        expect(ds.loadUintBig(64)).toBe(0n);
        expect(ds.loadUintBig(32)).toBe(0n);

        // Value related fields
        const vs = ds.loadRef().beginParse();

        expect(vs.loadCoins()).toBe(0n);
        expect(vs.loadCoins()).toBe(0n);
        expect(vs.loadMaybeRef()).toBeNull();

        const stateInitCell = ds.loadMaybeRef()!;
        expect(stateInitCell).toBeNull();

        for(let i = InMsgParams.bounce; i < InMsgParams.state_init; i++) {
            ds = (await version11.getInMsgParamsRaw(InMsgParams.all)).beginParse();

            switch(i) {
                case InMsgParams.bounce:
                case InMsgParams.bounced:
                    expect(ds.loadBit()).toBe(false);
                    break;
                case InMsgParams.src:
                    expect(ds.loadUint(2)).toBe(0);
                    break;
                case InMsgParams.fwd_fee:
                    expect(ds.loadCoins()).toBe(0n);
                    break;
                case InMsgParams.msg_lt:
                    expect(ds.loadUintBig(64)).toBe(0n);
                    break;
                case InMsgParams.msg_created_at:
                    expect(ds.loadUint(32)).toBe(0);
                    break;
                case InMsgParams.orig_value:
                case InMsgParams.value:
                    expect(ds.loadCoins()).toBe(0n);
                    break;
                case InMsgParams.extra:
                case InMsgParams.state_init:
                    expect(ds.loadMaybeRef()).toBeNull();
            }
        }
    });

    it('should reflect bounce flag correcty', async () => {
        const msgValue = BigInt(getRandomInt(100, 1337)) * toNano('0.001');

        for(let bounceMode of [true, false]) {
            for(let mode of [InMsgParams.all, InMsgParams.bounce]) {
                const msgBody  = Version11.testMsg(mode);
                const res = await deployer.send({
                    bounce: bounceMode, // Bounce false
                    to: version11.address,
                    body: msgBody,
                    value: msgValue,
                    sendMode: SendMode.PAY_GAS_SEPARATELY
                });

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        return ds.loadBit() == bounceMode; // Testing that resulting bit has expected value
                    }
                });
            }
        }
    });

    it('should reflect bounced flag correctly', async () => {
        for(let bouncedMode of [true, false]) {
            for(let mode of [InMsgParams.all, InMsgParams.bounced]) {
                const msgBody  = Version11.testMsg(mode);
                const res = await blockchain.sendMessage(internal({
                    from: deployer.address,
                    to: version11.address,
                    body: msgBody,
                    bounce: false,
                    bounced: bouncedMode,
                    value: toNano('1')
                }));
                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            expect(ds.loadBit()).toBe(false);
                        }
                        return ds.loadBit() == bouncedMode; // Testing that resulting bit has expected value
                    }
                });
            }
        }
    });

    it('should reflect source address correctly', async () => {
        for(let i = 0; i < 5; i++) {
            const msgValue = BigInt(getRandomInt(100, 1337)) * toNano('0.001');
            const senderWallet = await blockchain.treasury(`random_wallet_${i}`);

            for(let mode of [InMsgParams.all, InMsgParams.src]) {
                const msgBody  = Version11.testMsg(mode);

                const res = await senderWallet.send({
                    to: version11.address,
                    body: msgBody,
                    value: msgValue,
                    sendMode: SendMode.PAY_GAS_SEPARATELY
                });

                expect(res.transactions).toHaveTransaction({
                    on: senderWallet.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds.skip(1 + 1);
                        }
                        return ds.loadAddress().equals(senderWallet.address);
                    }
                });
            }
        }
    });

    it('should reflect fwd fee correctly', async () => {
        const hopHey = beginCell().storeStringTail("Hop hey").endCell();
        const La = beginCell().storeStringTail("Hop hey").storeStringRefTail("La").endCell();
        const LaLa = beginCell().storeStringTail("Hop hey").storeStringRefTail("La").storeStringRefTail("La").endCell();
        const LaLaLey = beginCell().storeStringTail("Hop hey").storeStringRefTail("La").storeStringRefTail("La").storeStringRefTail("Ley!").endCell();

        let oldFwd = 0n;
        let newFwd = 0n;
        const msgValue = BigInt(getRandomInt(100, 1337)) * toNano('0.001');

        for(let payload of [hopHey, La, LaLa, LaLaLey]) {
            for(let mode of [InMsgParams.all, InMsgParams.fwd_fee]) {
                const res = await version11.sendTestInmsgParams(deployer.getSender(), mode, msgValue, payload);

                const testTx = findTransactionRequired(res.transactions, {
                    on: version11.address,
                    from: deployer.address,
                    op: mode,
                    aborted: false,
                    outMessagesCount: 1
                });

                const inMsg = testTx.inMessage!;

                if(inMsg.info.type !== 'internal') {
                    throw new Error("No way");
                }

                // Self test
                expect(inMsg.info.forwardFee).not.toEqual(oldFwd);

                newFwd = inMsg.info.forwardFee;

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds.skip(1 + 1 + 267); // bounce, bounced src_address
                        }
                        const curFwd = ds.loadCoins();
                        return curFwd == newFwd;
                    }
                });
            }
        }

        // Unpdate old fwd for next payload
        oldFwd = newFwd;
    });

    it('should reflect message created_lt correctly', async () => {
        const msgValue = BigInt(getRandomInt(100, 1337)) * toNano('0.001');
        let oldLt = 0n;

        for(let i = 0; i < 10; i++) {
            // On each iteration current_lt is going to grow
            for(let mode of [InMsgParams.all, InMsgParams.msg_lt]) {
                const res = await version11.sendTestInmsgParams(deployer.getSender(), mode, msgValue);
                const testTx = findTransactionRequired(res.transactions, {
                    on: version11.address,
                    from: deployer.address,
                    op: mode,
                    aborted: false,
                    outMessagesCount: 1
                });

                const inMsg = testTx.inMessage!;

                if(inMsg.info.type !== 'internal') {
                    throw new Error("No way");
                }

                // Self test
                const newLt = BigInt(inMsg.info.createdLt);
                expect(newLt).not.toEqual(oldLt);
                oldLt = newLt;

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds.skip(1 + 1 + 267); // bounce, bounced src_address
                            ds.loadCoins();
                        }
                        const curLt = ds.loadUintBig(64);
                        return curLt == newLt;
                    }
                });
            }
        }
    });


    it('should reflect message created_at correctly', async () => {
        const stateBefore = blockchain.snapshot();


        const msgValue = BigInt(getRandomInt(100, 1337)) * toNano('0.001');

        blockchain.now = Math.floor(Date.now() / 1000);
        let newAt = 0;

        for(let i = 0; i < 10; i++) {
            blockchain.now += getRandomInt(1, 1337);
            for(let mode of [InMsgParams.all, InMsgParams.msg_created_at]) {
                const res = await version11.sendTestInmsgParams(deployer.getSender(), mode, msgValue);
                const testTx = findTransactionRequired(res.transactions, {
                    on: version11.address,
                    from: deployer.address,
                    op: mode,
                    aborted: false,
                    outMessagesCount: 1
                });

                const inMsg = testTx.inMessage!;

                if(inMsg.info.type !== 'internal') {
                    throw new Error("No way");
                }

                newAt = inMsg.info.createdAt;

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds.skip(1 + 1 + 267); // bounce, bounced src_address
                            ds.loadCoins();
                            ds.skip(64); // Skip message_lt
                        }
                        return ds.loadUint(32) == newAt;
                    }
                });
            }
        }

        await blockchain.loadFrom(stateBefore);
    })

    it('should reflect original message value correctly', async () => {
        const stateBefore = blockchain.snapshot();
        const sendIhr = async (mode: InMsgParams) => {
                return await deployer.sendMessages([{
                info: {
                    value: {coins: toNano('1')},
                    ihrFee: 1n,
                    ihrDisabled: false,
                    type: 'internal',
                    createdAt: blockchain.now!,
                    createdLt: blockchain.lt,
                    bounce: true,
                    bounced: false,
                    forwardFee: 0n,
                    dest: version11.address,
                },
                body: Version11.testMsg(mode)
            }],SendMode.PAY_GAS_SEPARATELY);
        }

        const testStorage = async (mode: InMsgParams) => {
            blockchain.now = Math.floor(Date.now() / 1000);
            const smc = await blockchain.getContract(version11.address);
            // Since it's much bigger than 100, we expect storage fee to kick in
            smc.balance = toNano('0.2'); // Lower than expected storage fee

            return await deployer.send({
                bounce: false,
                to: version11.address,
                body: Version11.testMsg(mode),
                value: toNano('0.1')
            });
        };



        for(let mode of [InMsgParams.all, InMsgParams.orig_value]) {
            for(let testCase of [sendIhr, testStorage] ) {
                const res = await testCase(mode);

                const testTx = findTransactionRequired(res.transactions, {
                    on: version11.address,
                    from: deployer.address,
                    aborted: false,
                    outMessagesCount: 1
                });
                const inMsg = testTx.inMessage!;

                if(inMsg.info.type !== 'internal') {
                    throw new Error("No way");
                }

                // Orig value should always return value from message
                // regarless of any balance affects

                const origMsgValue = inMsg.info.value.coins;

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        let ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds = ds.loadRef().beginParse();
                        }
                        const origVal = ds.loadCoins();
                        return origVal == origMsgValue;
                    }
                });

            }
            await blockchain.loadFrom(stateBefore);
        }
    });

    it('should reflect actual message remaining balance correctly', async () => {
        const stateBefore = blockchain.snapshot();
        const sendIhr = async (mode: InMsgParams) => {
                return await deployer.sendMessages([{
                info: {
                    value: {coins: toNano('1')},
                    ihrFee: 1n,
                    ihrDisabled: false,
                    type: 'internal',
                    createdAt: blockchain.now!,
                    createdLt: blockchain.lt,
                    bounce: true,
                    bounced: false,
                    forwardFee: 0n,
                    dest: version11.address,
                },
                body: Version11.testMsg(mode)
            }],SendMode.PAY_GAS_SEPARATELY);
        }

        const testStorage = async (mode: InMsgParams) => {
            blockchain.now = Math.floor(Date.now() / 1000);
            const smc = await blockchain.getContract(version11.address);
            // Since it's much bigger than 100, we expect storage fee to kick in
            smc.balance = toNano('0.2'); // Lower than expected storage fee

            return await deployer.send({
                bounce: false,
                to: version11.address,
                body: Version11.testMsg(mode),
                value: toNano('0.1')
            });
        };

        for(let mode of [InMsgParams.all, InMsgParams.value]) {
            for(let testCase of [sendIhr, testStorage] ) {
                const res = await testCase(mode);

                const testTx = findTransactionRequired(res.transactions, {
                    on: version11.address,
                    from: deployer.address,
                    aborted: false,
                    outMessagesCount: 1
                });
                const inMsg = testTx.inMessage!;

                if(inMsg.info.type !== 'internal') {
                    throw new Error("No way");
                }


                const origMsgValue = inMsg.info.value.coins;

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        let ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds = ds.loadRef().beginParse();
                            ds.loadCoins(); // Skip orig
                        }
                        const remainingVal = ds.loadCoins();

                        /*
                        if(testCase === testStorage) {
                            console.log("Test storage");
                        }
                        */
                        return testCase === sendIhr ? remainingVal == origMsgValue
                            : remainingVal < origMsgValue && 
                            remainingVal == toNano('0.2') + origMsgValue - storageCollected(testTx) 
                    }
                });

                await blockchain.loadFrom(stateBefore);
            }
        }
    });

    it('should reflect message extra correctly', async () => {
        for(let mode of [InMsgParams.all, InMsgParams.extra]) {
            const testMsg = Version11.testMsg(mode);
            const extraValues: ExtraCurrency[] = [{123: BigInt(getRandomInt(1, 10000))}, {567: BigInt(getRandomInt(1, 100000)), 8910: BigInt(getRandomInt(1, 10000))}];

            for(let extra of [undefined, ...extraValues]) {
                const res = await blockchain.sendMessage(internal({
                    from: deployer.address,
                    to: version11.address,
                    body: testMsg,
                    value: toNano('1'),
                    ec: extra
                }));

                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        let ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds = ds.loadRef().beginParse();
                            ds.loadCoins(); // Skip orig_value
                            ds.loadCoins(); // Skip value
                        }
                        if(extra) {
                            const extraResp = parseEc(ds.loadMaybeRef());

                            for(let k in extra) {
                                const numKey = Number(k);
                                if(extra[numKey] !== extraResp[numKey]) {
                                    return false;
                                }
                            }
                        } else {
                            return ds.loadMaybeRef() === null;
                        }

                        return true;
                    }
                });
            }
        }
    });

    it('should reflect state init correctly', async () => {
        const randomCell = beginCell().storeUint(getRandomInt(0, 100000), 32).endCell();

        let dataTuples: ([Cell | null, Cell | null] | null)[] = [
            null,
            [null, null],
            [null, code],
            [randomCell, code],
        ];


        /*
        const testInternal = async(mode: InMsgParams, tuple: typeof dataTuples[number]) => {
            const msgBody = Version11.testMsg(mode);
            return await deployer.send({
                    to: version11.address,
                    value: toNano('1'),
                    body: msgBody,
                    init: tuple ? {data: tuple[0], code: tuple[1]} : null
        });
        }
        const testExternal = async(mode: InMsgParams, tuple: typeof dataTuples[number]) => {
            const msgBody = Version11.testMsgExternal(mode, deployer.address);
            return await blockchain.sendMessage(external({
                    to: version11.address,
                    body: msgBody,
                    init: tuple ? {data: tuple[0], code: tuple[1]} : null
            }));
        }
        */

        for(let mode of [InMsgParams.all, InMsgParams.state_init]) {
            const msgBody = Version11.testMsg(mode);
            for(let tuple of dataTuples) {
                const res = await deployer.send({
                    to: version11.address,
                    value: toNano('1'),
                    body: msgBody,
                    init: tuple ? {data: tuple[0], code: tuple[1]} : null
                });
                expect(res.transactions).toHaveTransaction({
                    on: deployer.address,
                    from: version11.address,
                    inMessageBounced: false,
                    body: (b) => {
                        const ds = b!.beginParse().skip(32 + 64);
                        if(mode == InMsgParams.all) {
                            ds.skip(1 + 1); // bounce, bounced src_address
                            ds.loadAddressAny(); // Skip addr_none
                            ds.loadCoins();
                            ds.skip(64 + 32); // Skip message_lt and created_at
                            ds.loadRef(); // Skip cell with value related fields
                        }

                        // Geez too many returns, bruh
                        if(tuple) {
                            const stateInitCell = ds.loadMaybeRef();

                            if(stateInitCell === null) {
                                return false;
                            }

                            const stateParsed = loadStateInit(stateInitCell.beginParse());

                            if(tuple[0]) {
                                if(!stateParsed.data?.equals(tuple[0])) {
                                    return false
                                }
                            } else if(stateParsed.data) {
                                return false
                            }

                            if(tuple[1]) {
                                if(!stateParsed.code?.equals(tuple[1])) {
                                    return false
                                }
                            } else if(stateParsed.code) {
                                return false;
                            }
                        }

                        return true;
                    }
                });
            }
        }
    });

});
