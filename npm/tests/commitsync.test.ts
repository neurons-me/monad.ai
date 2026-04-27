// CommitSync protocol integration tests for Monad.ai
import ME from 'this.me';
import { appendSemanticMemory, listSemanticMemoriesByNamespace } from '../src/claim/memoryStore';

describe('CommitSync: Memory Ledger', () => {
  const testNamespace = 'user.cleaker.me';
  const initialMemory = {
    namespace: testNamespace,
    path: 'profile.name',
    operator: '=',
    data: 'Abella',
    timestamp: Date.now(),
  };

  it('should commit a new memory to the ledger', async () => {
    const memory = appendSemanticMemory(initialMemory);
    expect(memory.path).toBe('profile.name');
    expect(memory.hash).toBeTruthy();
  });

  it('should sync memories incrementally', async () => {
    const memories = listSemanticMemoriesByNamespace(testNamespace, { limit: 50 });
    expect(Array.isArray(memories)).toBe(true);
    expect(memories.some((memory) => memory.path === 'profile.name')).toBe(true);
  });
});

describe('SessionOrchestrator: Memory Replay', () => {
  it('should rebuild state by learning from the memory log', async () => {
    const me = new ME('test-seed-commitsync');

    const memoryLog = [
      { path: 'settings.theme', expression: 'dark', value: 'dark', operator: '=', hash: 'h1', timestamp: 1 },
      { path: 'settings.font', expression: 'mono', value: 'mono', operator: '=', hash: 'h2', timestamp: 2 }
    ];

    me.replayMemories(memoryLog);
    expect((me as any)('settings.theme')).toBe('dark');
    expect((me as any)('settings.font')).toBe('mono');
  });
});
