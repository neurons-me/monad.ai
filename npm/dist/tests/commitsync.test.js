"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// CommitSync protocol integration tests for Monad.ai
// Uses Jest and Supertest
const this_me_1 = __importDefault(require("this.me"));
const cleaker_1 = __importDefault(require("cleaker"));
const request = require('supertest');
const app = require('../server');
describe('CommitSync: Memory Ledger', () => {
    const testNamespace = 'user.cleaker.me';
    const initialMemory = {
        path: 'profile.name',
        operator: '=',
        value: 'Abella',
        hash: 'mem_hash_001',
        prevHash: null
    };
    it('should commit a new memory to the ledger', async () => {
        const res = await request(app)
            .post('/api/v1/commit')
            .send({
            namespace: testNamespace,
            memory: initialMemory,
            signature: 'sig_alpha'
        });
        expect(res.status).toBe(201);
        expect(res.body.hash).toBe('mem_hash_001');
    });
    it('should sync memories incrementally', async () => {
        const res = await request(app)
            .get('/api/v1/sync')
            .query({ namespace: testNamespace, afterHash: 'mem_hash_001' });
        expect(res.status).toBe(200);
        expect(res.body.memories).toBeDefined();
    });
});
describe('SessionOrchestrator: Memory Replay', () => {
    it('should rebuild state by learning from the memory log', async () => {
        const me = new this_me_1.default();
        const node = (0, cleaker_1.default)(me, {
            namespace: 'user.cleaker.me',
            origin: 'http://localhost:8161',
        });
        const memoryLog = [
            { path: 'settings.theme', value: 'dark', operator: '=', hash: 'h1' },
            { path: 'settings.font', value: 'mono', operator: '=', hash: 'h2' }
        ];
        memoryLog.forEach(mem => me.learn(mem));
        expect(me.settings.theme).toBe('dark');
        expect(me.settings.font).toBe('mono');
    });
});
