import { Transaction } from '@ton/core';
const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

export const getRandomInt = (min: number, max: number) => {
    return Math.round(getRandom(min, max));
}

export const storageCollected = (trans:Transaction) => {
    if(trans.description.type !== "generic")
        throw("Expected generic transaction");
    return trans.description.storagePhase ? trans.description.storagePhase.storageFeesCollected : 0n;
}
