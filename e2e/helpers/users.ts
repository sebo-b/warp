// Accounts created by warp/sql/schema.sql and warp/sql/sample_data.sql.
// account_type: 10 = admin, 20 = regular user, 100 = group (cannot log in).

export interface TestUser {
  login: string;
  password: string;
  name: string;
}

export const ADMIN: TestUser = { login: 'admin', password: 'noneshallpass', name: 'Admin' };

export const USER1: TestUser = { login: 'user1', password: 'password', name: 'Foo' };
export const USER2: TestUser = { login: 'user2', password: 'password', name: 'Bar' };
export const USER3: TestUser = { login: 'user3', password: 'password', name: 'Baz' };
