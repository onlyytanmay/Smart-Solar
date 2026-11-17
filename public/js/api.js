/* API client and session storage. Plain globals, no framework. */

const Session = {
  TOKEN_KEY: 'ss_token',
  USER_KEY: 'ss_user',
  save(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  token() { return localStorage.getItem(this.TOKEN_KEY); },
  isLoggedIn() { return !!this.token(); },
  clear() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }
};

const API = {
  base: '/api',

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = Session.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error('Cannot reach the server. Is "npm start" running?');
    }

    const data = await res.json().catch(() => ({}));

    // Expired or invalid session: send the user back to login (auth endpoints excluded)
    if (res.status === 401 && !path.startsWith('/auth/')) {
      Session.clear();
      location.replace('login.html');
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.details = data.errors;
      throw err;
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); }
};
