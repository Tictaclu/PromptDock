import * as vscode from 'vscode';

export class FakeMemento implements vscode.Memento {
  private readonly store = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    // Real globalState round-trips through JSON, so clone to catch code that
    // mutates a read value without persisting it back via update().
    if (!this.store.has(key)) {
      return defaultValue;
    }
    return JSON.parse(JSON.stringify(this.store.get(key))) as T;
  }

  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, JSON.parse(JSON.stringify(value)));
    }
    return Promise.resolve();
  }
}
