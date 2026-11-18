// A small client for the LegalSent API. No dependencies: Node.js 18 or later.
//
//   import { LegalSent } from './legalsent.mjs';
//   const api = new LegalSent();                 // reads LEGALSENT_API_KEY
//   console.log(await api.balance());
//
// Reference: https://api.legalsent.com/llms-full.txt
//
// There is no sandbox. The three methods that deliver a communication and
// charge the wallet (sendDispatch, dispatchCampaign, resendRecipient) refuse
// to run unless called with `confirm: true`, so that nothing is ever sent by
// a script that was only being tried out.
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** Every non-2xx answer. Branch on `code`; `reason` and `fields` say what to fix. */
export class LegalSentError extends Error {
  constructor(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    super(`${status} ${b.code || 'ERROR'}${b.reason ? ` (${b.reason})` : ''}: ${b.error || 'request failed'}`);
    this.name = 'LegalSentError';
    this.status = status;
    this.code = b.code || null;
    this.reason = b.reason || null;
    this.fields = b.fields || [];
    this.requestId = b.requestId || null; // quote this when asking for support
    this.body = body;
  }
}

function toFile(file) {
  if (typeof file === 'string') file = { path: file };
  const name = file.name || path.basename(file.path);
  const type = file.type || MIME[path.extname(name).toLowerCase()];
  if (!type) throw new Error(`${name}: only PDF, plain text, JPEG and PNG files can be sent`);
  const data = file.data ?? fs.readFileSync(file.path);
  return { name, blob: new Blob([data], { type }) };
}

function needConfirm(options, what) {
  if (options?.confirm !== true) {
    throw new Error(`${what} delivers a real communication and charges the wallet: there is no test mode. Pass { confirm: true } when you mean it.`);
  }
}

export class LegalSent {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]    default: LEGALSENT_API_KEY
   * @param {string} [options.baseUrl]   default: LEGALSENT_BASE_URL or https://api.legalsent.com
   * @param {number} [options.timeoutMs] default: 120000 (a send can take up to a minute)
   * @param {object} [options.headers]   extra headers on every request (a proxy, for instance)
   */
  constructor({ apiKey = process.env.LEGALSENT_API_KEY, baseUrl = process.env.LEGALSENT_BASE_URL || 'https://api.legalsent.com', timeoutMs = 120000, headers = {} } = {}) {
    if (!apiKey) throw new Error('No API key: set LEGALSENT_API_KEY or pass { apiKey }.');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.headers = headers;
  }

  /** One request. Returns parsed JSON, or a Buffer when `binary` is set. */
  async request(method, pathname, { query, json, form, binary = false } = {}) {
    const url = new URL(this.baseUrl + pathname);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers = { ...this.headers, Authorization: `Bearer ${this.apiKey}` };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form; // fetch sets the multipart boundary itself
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      let parsed = null;
      try { parsed = await res.json(); } catch { /* 405 and 413 have no JSON body */ }
      throw new LegalSentError(res.status, parsed);
    }
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }

  // ------------------------------------------------------------ wallet and account
  /** { success, balance, currency }: credit left, in euro. */
  balance() { return this.request('GET', '/api/payment/balance'); }
  /** Last 100 movements of the wallet. */
  transactions() { return this.request('GET', '/api/payment/transactions'); }
  /** The account's own rates, if it has them, and its partner's. */
  pricingProfile() { return this.request('GET', '/api/user/pricing-profile'); }
  /** Standard rates: { ERDS: "3.05", QERDS: "4.27" }. */
  systemRates() { return this.request('GET', '/api/system-settings/rates'); }
  /** About the key in use (never the key itself). */
  apiKeyInfo() { return this.request('GET', '/api/user/api-key'); }

  /**
   * Euro for one delivery (one recipient on one channel) of the given type.
   * Own rates first, then the partner's, then the standard ones.
   */
  async rateFor(requestType) {
    const key = requestType === 'QERDS' ? 'qerdsRate' : 'erdsRate';
    const profile = await this.pricingProfile();
    if (profile.hasCustomPricing && profile[key] != null) return Number(profile[key]);
    if (profile.partner && profile.partner[key] != null) return Number(profile.partner[key]);
    return Number((await this.systemRates())[requestType]);
  }

  // ------------------------------------------------------------ dispatches
  /**
   * Send one communication to one recipient. REAL: it is delivered and charged.
   *
   * @param {object} d
   * @param {'ERDS'|'QERDS'} d.requestType
   * @param {Array<'EMAIL'|'SMS'>} d.channels          each channel is a separate, paid delivery
   * @param {object} d.recipient                       { firstName, lastName, email, telefono, codiceFiscale }
   * @param {string} [d.subject]                       subject of the email
   * @param {string} [d.content]                       text of the communication, when no file is sent
   * @param {Array<string|{path?:string,name?:string,data?:Buffer,type?:string}>} [d.files]
   * @param {string} [d.bulkDispatchId]
   * @param {string} [d.contactListId]
   * @param {{confirm: boolean}} options
   * @returns {Promise<{success:true, requestId:string, status:string, amount:number}>} requestId is the dispatch id
   */
  sendDispatch(d, options) {
    needConfirm(options, 'sendDispatch');
    return this.request('POST', '/api/dispatches', { form: this.dispatchForm(d) });
  }

  /** The multipart body of a send, without sending it. Useful to look at what would go out. */
  dispatchForm({ requestType, channels, recipient, subject, content, files = [], bulkDispatchId, contactListId }) {
    if (!['ERDS', 'QERDS'].includes(requestType)) throw new Error('requestType must be "ERDS" or "QERDS"');
    if (!Array.isArray(channels) || channels.length === 0) throw new Error('channels must be ["EMAIL"], ["SMS"] or both: each one is a separate, paid delivery');
    if (!recipient || typeof recipient !== 'object') throw new Error('recipient is required: do not rely on extraction from the document');
    if (!content && files.length === 0) throw new Error('send content, files, or both');
    const form = new FormData();
    form.append('requestType', requestType);
    form.append('channels', channels.join(','));
    form.append('recipientData', JSON.stringify(recipient));
    if (subject) form.append('emailSubject', subject);
    if (content) form.append('content', content);
    if (bulkDispatchId) form.append('bulk_dispatch_id', bulkDispatchId);
    if (contactListId) form.append('contact_list_id', contactListId);
    for (const f of files.map(toFile)) form.append('file', f.blob, f.name);
    return form;
  }

  /** { data, pagination }, newest first. */
  listDispatches({ page, limit, name, bulkDispatchId } = {}) {
    return this.request('GET', '/api/dispatches', { query: { page, limit, name, bulkDispatchId } });
  }
  /** One dispatch, with the latest events. Do not call more than once a minute per dispatch. */
  getDispatch(id) { return this.request('GET', `/api/dispatches/${id}`); }
  /** The proof of delivery, as a PDF. 404 NOT_FOUND until it exists: check `audit_available` first. */
  downloadAudit(id, { channel } = {}) {
    return this.request('GET', `/api/dispatches/${id}/audit`, { query: { channel }, binary: true });
  }
  /** Poll until the dispatch is COMPLETED, OPENED or FAILED. Statuses are refreshed every five minutes. */
  async waitForDispatch(id, { intervalMs = 120000, timeoutMs = 3600000, onPoll } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const d = await this.getDispatch(id);
      if (onPoll) onPoll(d);
      if (['COMPLETED', 'OPENED', 'FAILED', 'CANCELLED'].includes(d.status)) return d;
      if (Date.now() + intervalMs > deadline) throw new Error(`dispatch ${id} is still ${d.status} after ${Math.round(timeoutMs / 60000)} minutes`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // ------------------------------------------------------------ groups of dispatches
  createGroup(metadata = {}) { return this.request('POST', '/api/bulk-dispatches', { json: { metadata } }); }
  listGroups({ page, limit } = {}) { return this.request('GET', '/api/bulk-dispatches', { query: { page, limit } }); }

  // ------------------------------------------------------------ campaigns
  /** Create a DRAFT. Nothing is sent or charged. Check `recipientIssues` in the answer. */
  createCampaign({ requestType, channels, name, subject, message, recipients = [], files = [], contactListId }) {
    const form = new FormData();
    form.append('requestType', requestType);
    form.append('campaignName', name);
    if (channels) form.append('channels', channels.join(','));
    if (subject) form.append('emailSubject', subject);
    if (message) form.append('messageBody', message);
    form.append('recipients', JSON.stringify(recipients));
    if (contactListId) form.append('contact_list_id', contactListId);
    for (const f of files.map(toFile)) form.append('files', f.blob, f.name);
    return this.request('POST', '/api/campaigns', { form });
  }
  listCampaigns({ page, limit, status } = {}) { return this.request('GET', '/api/campaigns', { query: { page, limit, status } }); }
  getCampaign(id) { return this.request('GET', `/api/campaigns/${id}`); }
  /** changes: any of campaignName, emailSubject, messageBody, channels (array), requestType, recipients. */
  updateCampaign(id, changes) { return this.request('PUT', `/api/campaigns/${id}`, { json: changes }); }
  /** changes: { email, telefono } */
  updateRecipient(campaignId, recipientId, changes) {
    return this.request('PATCH', `/api/campaigns/${campaignId}/recipients/${recipientId}`, { json: changes });
  }
  duplicateCampaign(id) { return this.request('POST', `/api/campaigns/${id}/duplicate`); }
  /** Send the campaign to every pending recipient. REAL: delivered and charged. */
  dispatchCampaign(id, options) {
    needConfirm(options, 'dispatchCampaign');
    return this.request('POST', `/api/campaigns/${id}/dispatch`);
  }
  /** Send again to a FAILED or PARTIAL recipient. REAL: delivered and charged. */
  resendRecipient(campaignId, recipientId, options) {
    needConfirm(options, 'resendRecipient');
    return this.request('POST', `/api/campaigns/${campaignId}/recipients/${recipientId}/resend`);
  }

  // ------------------------------------------------------------ contact lists
  listContactLists({ page, limit } = {}) { return this.request('GET', '/api/contact-lists', { query: { page, limit } }); }
  createContactList({ name, description, contacts }) {
    return this.request('POST', '/api/contact-lists', { json: { listName: name, description, items: contacts } });
  }
  getContactList(id) { return this.request('GET', `/api/contact-lists/${id}`); }
  updateContactList(id, { name, description }) {
    return this.request('PUT', `/api/contact-lists/${id}`, { json: { listName: name, description } });
  }
  deleteContactList(id) { return this.request('DELETE', `/api/contact-lists/${id}`); }
  listContacts(listId, { page, limit, search } = {}) {
    return this.request('GET', `/api/contact-lists/${listId}/items`, { query: { page, limit, search } });
  }
  /** Adds contacts. One whose email is already in the list is updated instead. */
  addContacts(listId, contacts) { return this.request('POST', `/api/contact-lists/${listId}/items`, { json: { items: contacts } }); }
  /** Replaces every contact of the list. */
  replaceContacts(listId, contacts) { return this.request('PATCH', `/api/contact-lists/${listId}/items`, { json: { items: contacts } }); }
  updateContact(listId, contactId, changes) {
    return this.request('PUT', `/api/contact-lists/${listId}/items`, { json: { itemId: contactId, ...changes } });
  }
  deleteContact(listId, contactId) {
    return this.request('DELETE', `/api/contact-lists/${listId}/items`, { query: { itemId: contactId } });
  }
}
