"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const misc_1 = require("../common/util/misc");
const MockOrm_1 = __importDefault(require("./MockOrm"));
async function getOne(email) {
    const db = await MockOrm_1.default.openDb();
    for (const user of db.users) {
        if (user.email === email) {
            return user;
        }
    }
    return null;
}
async function persists(id) {
    const db = await MockOrm_1.default.openDb();
    for (const user of db.users) {
        if (user.id === id) {
            return true;
        }
    }
    return false;
}
async function getAll() {
    const db = await MockOrm_1.default.openDb();
    return db.users;
}
async function add(user) {
    const db = await MockOrm_1.default.openDb();
    user.id = (0, misc_1.getRandomInt)();
    db.users.push(user);
    return MockOrm_1.default.saveDb(db);
}
async function update(user) {
    const db = await MockOrm_1.default.openDb();
    for (let i = 0; i < db.users.length; i++) {
        if (db.users[i].id === user.id) {
            db.users[i] = user;
            return MockOrm_1.default.saveDb(db);
        }
    }
}
async function delete_(id) {
    const db = await MockOrm_1.default.openDb();
    for (let i = 0; i < db.users.length; i++) {
        if (db.users[i].id === id) {
            db.users.splice(i, 1);
            return MockOrm_1.default.saveDb(db);
        }
    }
}
async function deleteAllUsers() {
    const db = await MockOrm_1.default.openDb();
    db.users = [];
    return MockOrm_1.default.saveDb(db);
}
async function insertMult(users) {
    const db = await MockOrm_1.default.openDb(), usersF = [...users];
    for (const user of usersF) {
        user.id = (0, misc_1.getRandomInt)();
        user.createdAt = new Date();
    }
    db.users = [...db.users, ...users];
    await MockOrm_1.default.saveDb(db);
    return usersF;
}
exports.default = {
    getOne,
    persists,
    getAll,
    add,
    update,
    delete: delete_,
    deleteAllUsers,
    insertMult,
};
