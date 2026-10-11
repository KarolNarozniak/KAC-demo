import { createDemoState } from './fixtures';
import type { DemoState } from '../domain/model';
export interface DemoRepository { load(): DemoState; reset(): DemoState }
export class InMemoryDemoRepository implements DemoRepository {
  private state = createDemoState();
  load(): DemoState { return structuredClone(this.state); }
  reset(): DemoState { this.state = createDemoState(); return this.load(); }
}
