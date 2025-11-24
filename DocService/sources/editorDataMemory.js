/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';
const config = require('config');
const ms = require('ms');
const utils = require('./../../Common/sources/utils');
const commonDefines = require('./../../Common/sources/commondefines');
const tenantManager = require('./../../Common/sources/tenantManager');
const logger = require('../../Common/sources/logger');
const debugLogger = logger.getLogger('nodeJS');

const cfgExpMonthUniqueUsers = ms(config.get('services.CoAuthoring.expire.monthUniqueUsers'));

function EditorCommon() {
  // this data obj will be passed around as reference between functions of editor 
  // => data obj sẽ được thay đổi dựa theo mục đích của function
  // => cần thêm redis để lưu lại giá trị của cái data obj này và chia sẻ nó giữa
  // các node OnlyOffice
  // => sửa các function thêm/sửa/xóa data và _getDocumentData
  this.data = {};
}
EditorCommon.prototype.connect = async function () {};
EditorCommon.prototype.isConnected = function() {
  return true;
};
EditorCommon.prototype.ping = async function() {return "PONG"};
EditorCommon.prototype.close = async function() {};
EditorCommon.prototype.healthCheck = async function() {
  if (this.isConnected()) {
    await this.ping();
    return true;
  }
  return false;
};
EditorCommon.prototype._getDocumentData = function(ctx, docId) {
  debugLogger.debug(`run _getDocumentData with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let tenantData = this.data[ctx.tenant];
  if (!tenantData) {
    this.data[ctx.tenant] = tenantData = {};
  }
  let options = tenantData[docId];
  if (!options) {
    tenantData[docId] = options = {};
  }
  debugLogger.debug(`_getDocumentData result: ${options}\n`)
  return options;
};
EditorCommon.prototype._checkAndLock = function(ctx, name, docId, fencingToken, ttl) {
  debugLogger.debug(`run _checkAndLock with params:\n ctx: ${ctx}\n name: ${name}\n docId: ${docId}\n fencingToken: ${fencingToken}\n ttl: ${ttl}\n`)
  let data = this._getDocumentData(ctx, docId);
  const now = Date.now();
  let res = true;
  if (data[name] && now < data[name].expireAt && fencingToken !== data[name].fencingToken) {
    res = false;
  } else {
    const expireAt = now + ttl * 1000;
    data[name] = {fencingToken: fencingToken, expireAt: expireAt};
  }
  debugLogger.debug(`_checkAndLock result: ${res}\n`)
  return res;
};
EditorCommon.prototype._checkAndUnlock = function(ctx, name, docId, fencingToken) {
  debugLogger.debug(`run _checkAndUnLock with params:\n ctx: ${ctx}\n name: ${name}\n docId: ${docId}\n fencingToken: ${fencingToken}\n`)
  let data = this._getDocumentData(ctx, docId);
  const now = Date.now();
  let res;
  if (data[name] && now < data[name].expireAt) {
    if (fencingToken === data[name].fencingToken) {
      res = commonDefines.c_oAscUnlockRes.Unlocked;
      delete data[name];
    } else {
      res = commonDefines.c_oAscUnlockRes.Locked;
    }
  } else {
    res = commonDefines.c_oAscUnlockRes.Empty;
    delete data[name];
  }
  debugLogger.debug(`_checkAndUnLock result: ${res}\n`)
  return res;
};

function EditorData() {
  EditorCommon.call(this);
  this.forceSaveTimer = {};
}
EditorData.prototype = Object.create(EditorCommon.prototype);
EditorData.prototype.constructor = EditorData;

EditorData.prototype.addPresence = async function(ctx, docId, userId, userInfo) {};
EditorData.prototype.updatePresence = async function(ctx, docId, userId) {};
EditorData.prototype.removePresence = async function(ctx, docId, userId) {};
EditorData.prototype.getPresence = async function(ctx, docId, connections) {
  debugLogger.debug(`run getPresence with params:\n ctx: ${ctx}\n docId: ${docId}\n connection: ${connections}\n`)
  let hvals = [];
  if (connections) {
    for (let i = 0; i < connections.length; ++i) {
      let conn = connections[i];
      if (conn.docId === docId && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
        hvals.push(utils.getConnectionInfoStr(conn));
      }
    }
  }
  debugLogger.debug(`getPresense result: ${hvals}\n`)
  return hvals;
};

EditorData.prototype.lockSave = async function(ctx, docId, userId, ttl) {
  debugLogger.debug(`run lockSave (call this._checkAndLock) with params:\n ctx: ${ctx}\n docId: ${docId}\n userId: ${userId}\n ttl: ${ttl}\n`)
  return this._checkAndLock(ctx, 'lockSave', docId, userId, ttl);
};
EditorData.prototype.unlockSave = async function(ctx, docId, userId) {
  debugLogger.debug(`run unlockSave (call this._checkAndUnLock) with params:\n ctx: ${ctx}\n docId: ${docId}\n userId: ${userId}\n`)
  return this._checkAndUnlock(ctx, 'lockSave', docId, userId);
};
EditorData.prototype.lockAuth = async function(ctx, docId, userId, ttl) {
  debugLogger.debug(`run lockAuth (call this._checkAndLock) with params:\n ctx: ${ctx}\n docId: ${docId}\n userId: ${userId}\n ttl: ${ttl}\n`)
  return this._checkAndLock(ctx, 'lockAuth', docId, userId, ttl);
};
EditorData.prototype.unlockAuth = async function(ctx, docId, userId) {
  debugLogger.debug(`run unlockAuth (call this._checkAndUnlock) with params:\n ctx: ${ctx}\n docId: ${docId}\n userId: ${userId}\n`)
  return this._checkAndUnlock(ctx, 'lockAuth', docId, userId);
};

EditorData.prototype.getDocumentPresenceExpired = async function(now) {
  return [];
};
EditorData.prototype.removePresenceDocument = async function(ctx, docId) {};

EditorData.prototype.addLocks = async function(ctx, docId, locks) {
  debugLogger.debug(`run addLocks with params:\n ctx: ${ctx}\n docId: ${docId}\n locks: ${locks}\n`)
  let data = this._getDocumentData(ctx, docId);
  if (!data.locks) {
    data.locks = {};
  }
  Object.assign(data.locks, locks);
};
EditorData.prototype.addLocksNX = async function(ctx, docId, locks) {
  debugLogger.debug(`run addLocksNX with params:\n ctx: ${ctx}\n docId: ${docId}\n locks: ${locks}\n`)
  let data = this._getDocumentData(ctx, docId);
  if (!data.locks) {
    data.locks = {};
  }
  let lockConflict = {};
  for (let lockId in locks) {
    if (undefined === data.locks[lockId]) {
      data.locks[lockId] = locks[lockId];
    } else {
      lockConflict[lockId] = locks[lockId];
    }
  }
  return {lockConflict, allLocks: data.locks};
};
EditorData.prototype.removeLocks = async function(ctx, docId, locks) {
  debugLogger.debug(`run removeLocks with params:\n ctx: ${ctx}\n docId: ${docId}\n locks: ${locks}\n`)
  let data = this._getDocumentData(ctx, docId);
  if (data.locks) {
    for (let lockId in locks) {
      delete data.locks[lockId];
    }
  }
};
EditorData.prototype.removeAllLocks = async function(ctx, docId) {
  debugLogger.debug(`run removeAllLocks with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  data.locks = undefined;
};
EditorData.prototype.getLocks = async function(ctx, docId) {
  debugLogger.debug(`run getLocks with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  return data.locks || {};
};

EditorData.prototype.addMessage = async function(ctx, docId, msg) {
  debugLogger.debug(`run addMessage with params:\n ctx: ${ctx}\n docId: ${docId}\n msg: ${msg}\n`)
  let data = this._getDocumentData(ctx, docId);
  if (!data.messages) {
    data.messages = [];
  }
  data.messages.push(msg);
};
EditorData.prototype.removeMessages = async function(ctx, docId) {
  debugLogger.debug(`run removeMessages with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  data.messages = undefined;
};
EditorData.prototype.getMessages = async function(ctx, docId) {
  debugLogger.debug(`run getMessages with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  debugLogger.debug(`getMessages result: ${data.messages || []}\n`)
  return data.messages || [];
};

EditorData.prototype.setSaved = async function(ctx, docId, status) {
  debugLogger.debug(`run setSaved with params:\n ctx: ${ctx}\n docId: ${docId}\n status: ${status}\n`)
  let data = this._getDocumentData(ctx, docId);
  data.saved = status;
};
EditorData.prototype.getdelSaved = async function(ctx, docId) {
  debugLogger.debug(`run getdelSaved with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  let res = data.saved;
  data.saved = null;
  debugLogger.debug(`getdelSaved result: ${res}\n`)
  return res;
};
EditorData.prototype.setForceSave = async function(ctx, docId, time, index, baseUrl, changeInfo, convertInfo) {
  debugLogger.debug(`run setForceSave with params:\n ctx: ${ctx}\n docId: ${docId}\n time: ${time}\n index: ${index}\n baseUrl: ${baseUrl}\n changeInfo: ${changeInfo}\n convertInfo: ${convertInfo}\n`)
  let data = this._getDocumentData(ctx, docId);
  data.forceSave = {time, index, baseUrl, changeInfo, started: false, ended: false, convertInfo};
};
EditorData.prototype.getForceSave = async function(ctx, docId) {
  debugLogger.debug(`run getForceSave with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  debugLogger.debug(`getForceSave result: ${data.forceSave || null}\n`)
  return data.forceSave || null;
};
EditorData.prototype.checkAndStartForceSave = async function(ctx, docId) {
  debugLogger.debug(`run checkAndStartForceSave with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  let res;
  if (data.forceSave && !data.forceSave.started) {
    data.forceSave.started = true;
    data.forceSave.ended = false;
    res = data.forceSave;
  }
  debugLogger.debug(`checkAndStartForceSave result: ${res}\n`)
  return res;
};
EditorData.prototype.checkAndSetForceSave = async function(ctx, docId, time, index, started, ended, convertInfo) {
  debugLogger.debug(`run checkAndSetForceSave with params:\n ctx: ${ctx}\n docId: ${docId}\n time: ${time}\n index: ${index}\n started: ${started}\n ended: ${ended}\n convertInfo: ${convertInfo}\n`)
  let data = this._getDocumentData(ctx, docId);
  let res;
  if (data.forceSave && time === data.forceSave.time && index === data.forceSave.index) {
    data.forceSave.started = started;
    data.forceSave.ended = ended;
    data.forceSave.convertInfo = convertInfo;
    res = data.forceSave;
  }
  debugLogger.debug(`checkAndSetForceSave result: ${res}\n`)
  return res;
};
EditorData.prototype.removeForceSave = async function(ctx, docId) {
  debugLogger.debug(`run removeForceSave with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let data = this._getDocumentData(ctx, docId);
  data.forceSave = undefined;
};

EditorData.prototype.cleanDocumentOnExit = async function(ctx, docId) {
  debugLogger.debug(`run cleanDocumentOnExit with params:\n ctx: ${ctx}\n docId: ${docId}\n`)
  let tenantData = this.data[ctx.tenant];
  if (tenantData) {
    delete tenantData[docId];
  }
  let tenantTimer = this.forceSaveTimer[ctx.tenant];
  if (tenantTimer) {
    delete tenantTimer[docId];
  }
};

EditorData.prototype.addForceSaveTimerNX = async function(ctx, docId, expireAt) {
  debugLogger.debug(`run addForceSaveTimerNX with params:\n ctx: ${ctx}\n docId: ${docId}\n expireAt: ${expireAt}\n`)
  let tenantTimer = this.forceSaveTimer[ctx.tenant];
  if (!tenantTimer) {
    this.forceSaveTimer[ctx.tenant] = tenantTimer = {};
  }
  if (!tenantTimer[docId]) {
    tenantTimer[docId] = expireAt;
  }
};
EditorData.prototype.getForceSaveTimer = async function(now) {
  debugLogger.debug(`run getForceSaveTimer with params:\n now: ${now}\n`)
  let res = [];
  for (let tenant in this.forceSaveTimer) {
    if (this.forceSaveTimer.hasOwnProperty(tenant)) {
      let tenantTimer = this.forceSaveTimer[tenant];
      for (let docId in tenantTimer) {
        if (tenantTimer.hasOwnProperty(docId)) {
          if (tenantTimer[docId] < now) {
            res.push([tenant, docId]);
            delete tenantTimer[docId];
          }
        }
      }
    }
  }
  debugLogger.debug(`getForceSaveTimer result: ${res}\n`)
  return res;
};

function EditorStat() {
  EditorCommon.call(this);
  this.uniqueUser = {};
  this.uniqueUsersOfMonth = {};
  this.uniqueViewUser = {};
  this.uniqueViewUsersOfMonth = {};
  this.stat = {};
  this.shutdown = {};
  this.license = {};
}
EditorStat.prototype = Object.create(EditorCommon.prototype);
EditorStat.prototype.constructor = EditorStat;
EditorStat.prototype.addPresenceUniqueUser = async function(ctx, userId, expireAt, userInfo) {
  debugLogger.debug(`run addPresenceUniqueUser with params:\n ctx: ${ctx}\n userId: ${userId}\n expireAt: ${expireAt}\n userInfo: ${userInfo}\n`)
  let tenantUser = this.uniqueUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUser[ctx.tenant] = tenantUser = {};
  }
  tenantUser[userId] = {expireAt: expireAt, userInfo: userInfo};
};
EditorStat.prototype.getPresenceUniqueUser = async function(ctx, nowUTC) {
  debugLogger.debug(`run getPresenceUniqueUser with params:\n ctx: ${ctx}\n nowUTC: ${nowUTC}\n`)
  let res = [];
  let tenantUser = this.uniqueUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUser[ctx.tenant] = tenantUser = {};
  }
  for (let userId in tenantUser) {
    if (tenantUser.hasOwnProperty(userId)) {
      if (tenantUser[userId].expireAt > nowUTC) {
        let elem = tenantUser[userId];
        let newElem = {userid: userId, expire: new Date(elem.expireAt * 1000)};
        Object.assign(newElem, elem.userInfo);
        res.push(newElem);
      } else {
        delete tenantUser[userId];
      }
    }
  }
  debugLogger.debug(`getPresenceUniqueUser result: ${res}\n`)
  return res;
};
EditorStat.prototype.addPresenceUniqueUsersOfMonth = async function(ctx, userId, period, userInfo) {
  debugLogger.debug(`run addPresenceUniqueUsersOfMonth with params:\n ctx: ${ctx}\n userId: ${userId}\n period: ${period}\n userInfo: ${userInfo}\n`)
  let tenantUser = this.uniqueUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  if(!tenantUser[period]) {
    let expireAt = Date.now() + cfgExpMonthUniqueUsers;
    tenantUser[period] = {expireAt: expireAt, data: {}};
  }
  tenantUser[period].data[userId] = userInfo;
};
EditorStat.prototype.getPresenceUniqueUsersOfMonth = async function(ctx) {
  debugLogger.debug(`run getPresenceUniqueUsersOfMonth with params:\n ctx: ${ctx}\n`)
  let res = {};
  let nowUTC = Date.now();
  let tenantUser = this.uniqueUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  for (let periodId in tenantUser) {
    if (tenantUser.hasOwnProperty(periodId)) {
      if (tenantUser[periodId].expireAt <= nowUTC) {
        delete tenantUser[periodId];
      } else {
        let date = new Date(parseInt(periodId)).toISOString();
        res[date] = tenantUser[periodId].data;
      }
    }
  }
  debugLogger.debug(`getPresenceUniqueUsersOfMonth result: ${res}\n`)
  return res;
};

EditorStat.prototype.addPresenceUniqueViewUser = async function(ctx, userId, expireAt, userInfo) {
  debugLogger.debug(`run addPresenceUniqueViewUser with params:\n ctx: ${ctx}\n userId: ${userId}\n expireAt: ${expireAt}\n userInfo: ${userInfo}\n`)
  let tenantUser = this.uniqueViewUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUser[ctx.tenant] = tenantUser = {};
  }
  tenantUser[userId] = {expireAt: expireAt, userInfo: userInfo};
};
EditorStat.prototype.getPresenceUniqueViewUser = async function(ctx, nowUTC) {
  debugLogger.debug(`run getPresenceUniqueViewUser with params:\n ctx: ${ctx}\n nowUTC: ${nowUTC}\n`)
  let res = [];
  let tenantUser = this.uniqueViewUser[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUser[ctx.tenant] = tenantUser = {};
  }
  for (let userId in tenantUser) {
    if (tenantUser.hasOwnProperty(userId)) {
      if (tenantUser[userId].expireAt > nowUTC) {
        let elem = tenantUser[userId];
        let newElem = {userid: userId, expire: new Date(elem.expireAt * 1000)};
        Object.assign(newElem, elem.userInfo);
        res.push(newElem);
      } else {
        delete tenantUser[userId];
      }
    }
  }
  debugLogger.debug(`getPresenceUniqueViewUser result: ${res}\n`)
  return res;
};
EditorStat.prototype.addPresenceUniqueViewUsersOfMonth = async function(ctx, userId, period, userInfo) {
  debugLogger.debug(`run addPresenceUniqueViewUsersOfMonth with params:\n ctx: ${ctx}\n userId: ${userId}\n period: ${period}\n userInfo: ${userInfo}\n`)
  let tenantUser = this.uniqueViewUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  if(!tenantUser[period]) {
    let expireAt = Date.now() + cfgExpMonthUniqueUsers;
    tenantUser[period] = {expireAt: expireAt, data: {}};
  }
  tenantUser[period].data[userId] = userInfo;
};
EditorStat.prototype.getPresenceUniqueViewUsersOfMonth = async function(ctx) {
  debugLogger.debug(`run getPresenceUniqueViewUsersOfMonth with params:\n ctx: ${ctx}\n`)
  let res = {};
  let nowUTC = Date.now();
  let tenantUser = this.uniqueViewUsersOfMonth[ctx.tenant];
  if (!tenantUser) {
    this.uniqueViewUsersOfMonth[ctx.tenant] = tenantUser = {};
  }
  for (let periodId in tenantUser) {
    if (tenantUser.hasOwnProperty(periodId)) {
      if (tenantUser[periodId].expireAt <= nowUTC) {
        delete tenantUser[periodId];
      } else {
        let date = new Date(parseInt(periodId)).toISOString();
        res[date] = tenantUser[periodId].data;
      }
    }
  }
  debugLogger.debug(`getPresenceUniqueViewUsersOfMonth result: ${res}\n`)
  return res;
};
EditorStat.prototype.setEditorConnections = async function(ctx, countEdit, countLiveView, countView, now, precision) {
  debugLogger.debug(`run setEditorConnections with params:\n ctx: ${ctx}\n countEdit: ${countEdit}\n countLiveView: ${countLiveView}\n countView: ${countView}\n now: ${now}\n precision: ${precision}\n`)
  let tenantStat = this.stat[ctx.tenant];
  if (!tenantStat) {
    this.stat[ctx.tenant] = tenantStat = [];
  }
  tenantStat.push({time: now, edit: countEdit, liveview: countLiveView, view: countView});
  let i = 0;
  while (i < tenantStat.length && tenantStat[i] < now - precision[precision.length - 1].val) {
    i++;
  }
  tenantStat.splice(0, i);
};
EditorStat.prototype.getEditorConnections = async function(ctx) {
  debugLogger.debug(`run getEditorConnections with params:\n ctx: ${ctx}\n`)
  let tenantStat = this.stat[ctx.tenant];
  if (!tenantStat) {
    this.stat[ctx.tenant] = tenantStat = [];
  }
  debugLogger.debug(`getEditorConnections result: ${tenantStat}\n`)
  return tenantStat;
};
EditorStat.prototype.setEditorConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.incrEditorConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.getEditorConnectionsCount = async function(ctx, connections) {
  debugLogger.debug(`run getEditorConnectionsCount with params:\n ctx: ${ctx}\n connections: ${connections}\n`)
  let count = 0;
  if (connections) {
    for (let i = 0; i < connections.length; ++i) {
      let conn = connections[i];
      if (!(conn.isCloseCoAuthoring || (conn.user && conn.user.view)) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
        count++;
      }
    }
  }
  debugLogger.debug(`getEditorConnectionsCount result: ${count}\n`)
  return count;
};
EditorStat.prototype.setViewerConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.incrViewerConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.getViewerConnectionsCount = async function(ctx, connections) {
  debugLogger.debug(`run getViewerConnectionsCount with params:\n ctx: ${ctx}\n connections: ${connections}\n`)
  let count = 0;
  if (connections) {
    for (let i = 0; i < connections.length; ++i) {
      let conn = connections[i];
      if (conn.isCloseCoAuthoring || (conn.user && conn.user.view) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
        count++;
      }
    }
  }
  debugLogger.debug(`getViewerConnectionsCount result: ${count}\n`)
  return count;
};
EditorStat.prototype.setLiveViewerConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.incrLiveViewerConnectionsCountByShard = async function(ctx, shardId, count) {};
EditorStat.prototype.getLiveViewerConnectionsCount = async function(ctx, connections) {
  debugLogger.debug(`run getLiveViewerConnectionsCount with params:\n ctx: ${ctx}\n connections: ${connections}\n`)
  let count = 0;
  if (connections) {
    for (let i = 0; i < connections.length; ++i) {
      let conn = connections[i];
      if (utils.isLiveViewer(conn) && ctx.tenant === tenantManager.getTenantByConnection(ctx, conn)) {
        count++;
      }
    }
  }
  debugLogger.debug(`getLiveViewerConnectionsCount result: ${count}\n`)
  return count;
};
EditorStat.prototype.addShutdown = async function(key, docId) {
  debugLogger.debug(`run addShutdown with params:\n key: ${key}\n docId: ${docId}\n`)
  if (!this.shutdown[key]) {
    this.shutdown[key] = {};
  }
  this.shutdown[key][docId] = 1;
};
EditorStat.prototype.removeShutdown = async function(key, docId) {
  debugLogger.debug(`run removeShutdown with params:\n key: ${key}\n docId: ${docId}\n`)
  if (!this.shutdown[key]) {
    this.shutdown[key] = {};
  }
  delete this.shutdown[key][docId];
};
EditorStat.prototype.getShutdownCount = async function(key) {
  debugLogger.debug(`run getShutdownCount with params:\n key: ${key}\n`)
  let count = 0;
  if (this.shutdown[key]) {
    for (let docId in this.shutdown[key]) {
      if (this.shutdown[key].hasOwnProperty(docId)) {
        count++;
      }
    }
  }
  debugLogger.debug(`getShutdownCount result: ${count}\n`)
  return count;
};
EditorStat.prototype.cleanupShutdown = async function(key) {
  debugLogger.debug(`run cleanupShutdown with params:\n key: ${key}\n`)
  delete this.shutdown[key];
};
EditorStat.prototype.setLicense = async function(key, val) {
  debugLogger.debug(`run setLicense with params:\n key: ${key}\n val: ${val}\n`)
  this.license[key] = val;
};
EditorStat.prototype.getLicense = async function(key) {
  debugLogger.debug(`run getLicense with params:\n key: ${key}\n`)
  debugLogger.debug(`getLicense result: ${this.license[key] || null}\n`)
  return this.license[key] || null;
};
EditorStat.prototype.removeLicense = async function(key) {
  debugLogger.debug(`run removeLicense with params:\n key: ${key}\n`)
  delete this.license[key];
};
EditorStat.prototype.lockNotification = async function(ctx, notificationType, ttl) {
  //true NaN !== NaN
  debugLogger.debug(`run lockNotification (call this._checkAndLock) with params:\n ctx: ${ctx}\n notificationType: ${notificationType}\n ttl: ${ttl}\n`)
  return this._checkAndLock(ctx, notificationType, notificationType, NaN, ttl);
};

module.exports = {
  EditorData,
  EditorStat
}
