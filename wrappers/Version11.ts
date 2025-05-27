import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Dictionary, loadStateInit, Sender, SendMode } from '@ton/core';
import { ExtraCurrency } from '@ton/sandbox';

export type Version11Config = {};
export enum InMsgParams {
    all = 1,
    bounce,
    bounced,
    src,
    fwd_fee,
    msg_lt,
    msg_created_at,
    orig_value,
    value,
    extra,
    state_init
};

type InMsgCellParams    = InMsgParams.extra | InMsgParams.state_init;

export function parseEc(extraCell: Cell | null) {
    const r: ExtraCurrency = {};
    const parsed = Dictionary.loadDirect(Dictionary.Keys.Uint(32), Dictionary.Values.BigVarUint(5), extraCell)

    for(let [k, v] of parsed) {
        r[k] = v;
    }

    return r;
}
export function version11ConfigToCell(config: Version11Config): Cell {
    return beginCell().endCell();
}

export class Version11 implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Version11(address);
    }

    static createFromConfig(config: Version11Config, code: Cell, workchain = 0) {
        const data = version11ConfigToCell(config);
        const init = { code, data };
        return new Version11(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    static testMsg(op: InMsgParams, payload: Cell | null = null, queryId: number | bigint = 0) {
        return beginCell().storeUint(op, 32).storeUint(queryId, 64).storeMaybeRef(payload).endCell()
    }
    static testMsgExternal(op: InMsgParams, response: Address, payload: Cell | null = null, queryId: number | bigint = 0) {
        return beginCell().storeUint(op, 32).storeUint(queryId, 64).storeAddress(response).storeMaybeRef(payload).endCell()
    }

    async sendTestInmsgParams(provider: ContractProvider, via: Sender, op: InMsgParams, value: bigint, payload: Cell | null = null, queryId: number | bigint = 0, extra?: ExtraCurrency) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Version11.testMsg(op, payload, queryId),
            extracurrency: extra
        });
    }


    async getInMsgParamsRaw(provider: ContractProvider, op: InMsgParams) {
        return (await provider.get('test_get', [{type: 'int', value: BigInt(op)}])).stack.readCell();
    }
}
