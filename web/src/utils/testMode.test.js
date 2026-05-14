import { getMockData, TEST_USERS } from './testMode';

describe('test mode role scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('arbor-test-mode', 'true');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('lets sales director see tasks from every branch and only specialists plus self in users', () => {
    localStorage.setItem('user', JSON.stringify(TEST_USERS.dyrektorSprzedazy));

    const tasks = getMockData('/tasks/wszystkie');
    const users = getMockData('/uzytkownicy');

    expect(new Set(tasks.map((task) => task.oddzial_id))).toEqual(new Set([1, 2, 3]));
    expect(users.every((user) => user.rola === 'Specjalista' || user.id === TEST_USERS.dyrektorSprzedazy.id)).toBe(true);
  });

  it('keeps Wroclaw specialist scoped to Wroclaw branch data', () => {
    localStorage.setItem('user', JSON.stringify(TEST_USERS.specjalistaWroclaw));

    const tasks = getMockData('/tasks/wszystkie');
    const users = getMockData('/uzytkownicy');

    expect(tasks.length).toBeGreaterThan(0);
    expect(users.length).toBeGreaterThan(0);
    expect(tasks.every((task) => task.oddzial_id === TEST_USERS.specjalistaWroclaw.oddzial_id)).toBe(true);
    expect(users.every((user) => user.oddzial_id === TEST_USERS.specjalistaWroclaw.oddzial_id)).toBe(true);
  });
});
