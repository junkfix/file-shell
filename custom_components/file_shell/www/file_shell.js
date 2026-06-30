(function () {
"use strict";

console.log("File Shell 1.2.0");
const _id = (id) => document.getElementById(id);
const _qsa = (q, el) => Array.from((el || document).querySelectorAll(q));
const _qs = (q, el) => (el || document).querySelector(q);

const _on = (el, ev, fn, opt) => ev.split(' ').forEach(e => el.addEventListener(e, fn, opt));

const _off = (el, ev, fn) => ev.split(' ').forEach(e => el.removeEventListener(e, fn));

const _att = (el, k, v) => {
	if(!el){return '';}
	if(v === undefined){
		return el.getAttribute(k);
	}
	el.setAttribute(k, v);
};

const _tn = (t) => document.createTextNode(t);
const wait = (ms, fn) => {setTimeout(fn, ms);};

//here p = innerHTML/textContent =..., m = appendChild([m])
const _ce = (t, att, p, m) => {
	t = document.createElement(t);
	if(att){
		for(const k in att){_att(t, k, att[k]);}
	}
	if(p){
		for(const i in p) {
			t[i] = p[i];
		}		
	}
	if(m){
		(Array.isArray(m) ? m : [m]).forEach(i => {
			if(i){t.appendChild(i);}
		});
	}
	return t;
};

function throttle(fn, mx){
	if(!mx) return fn;
	let calm;
	return (...args)=>{
		if(calm){return;}
		fn.apply(this, args);
		calm = setTimeout(()=>{calm = 0;}, mx);
	};
}

const localTag = 'file_shell';
const localGet = (e) => localStorage.getItem(localTag+e);
const localSet = (k, v) => v == null ? localStorage.removeItem(localTag + k) : localStorage.setItem(localTag + k, v);


let opt = {};
const app = {
	auth: null,
	entities: [],
	token: null,
	curDir: "/",
	entries: [],
	openDirs: new Set(["/"]),
	cache: new Map(),
	sortBy: 'name',
	sortOrder: 'asc',
	terms: {},
	termSeq: 0,
	sidebar: 1,
	files: 1,
	favs: 1,
	uploads: 0,
	cmenu: 0,
	dark: false,
	font: Number(localGet('font')) || 100,
	find: 0,
	multi: 0,
	sel: {},
};

const els = {
	tree: _id("tree"),
	favs: _id("favs"),
	files: _id("files"),
	cmd: _id("cmd"),
	term: _id("term"),
	uploads: _id("uploads"),
	edit: _id("edit"),
	cmenu: _id("cmenu")
};

const tabs = {
	fixed: ['favs', 'files', 'uploads'],
	list: [],
	terms: [],
	open: 'files',
	x: {},
};

const TERM_PREFIX = 'cmd:';
const isTermTab = (id) => typeof id === 'string' && id.startsWith(TERM_PREFIX);
const termTitle = (cwd) => (cwd || '/').split('/').filter(Boolean).pop() || 'Terminal';

const edit = {
	cm: null,
	ext: {
		js: CM.javascript, mjs: CM.javascript, json: CM.javascript, ts: CM.javascript,
		py: CM.python,
		yaml: CM.yaml, yml: CM.yaml,
		jinja: CM.jinja,
		php: CM.php,
		html: CM.html, htm: CM.html,
		css: CM.css,
		sh: CM.shell, bash: CM.shell,
		properties: CM.properties, ini: CM.properties, conf: CM.properties
	},
	theme: new CM.Compartment(),
	lang: new CM.Compartment(),
	wrap: new CM.Compartment(),
	space: new CM.Compartment(),
	font: new CM.Compartment(),
};

function toast(message, opts = {}){
	opts = Object.assign({
		timeout: 4,
		theme: 'green',
		close: 0,
		prep: 0,
		click: null,
		html: false
	}, opts);
	
	const dismiss = () => {
		if(el){
			el.style.opacity = 0;
			wait(300,() => {el.remove();});
		}
	};
	
	const el = _ce('div',{'class': 'toast ' + opts.theme},{innerHTML: '<p>' + (opts.html ? message : escapeHtml(message)) + '</p>'});
	if(typeof opts.click === 'function'){
		el.onclick = (e) => {
			if(opts.click(e) !== false){dismiss();}
		};
	}else{
		el.onclick = dismiss;
	}
	
	if(opts.close){
		el.classList.add('close');
		el.insertBefore(_ce('i',{'class': 'rbtn ico-x'},{onclick: dismiss}), el.firstChild);
	}
	let tel = _id('toast');
	
	const nav = _ce('nav');
	el.appendChild(nav);
	if(opts.prep){
		tel.prepend(el);
	}else{
		tel.appendChild(el);
	}
	el.offsetHeight;
	el.style.opacity = 1;
	
	if(opts.timeout > 0){
		wait(1000 * opts.timeout, () => {
			dismiss();
		});
	}
	
	return {
		el,
		bar: (c, t) => { nav.style.width = ((c / t) * 100) + '%';},
		update: (msg) => {_qs('p',el).innerHTML = msg;},
		dismiss
	};
}

let lastpopclose = _=>{};
function popup(html='', head='Message', options={}){
	options = Object.assign({
		buttons: [{
			text: "Close",
			key: "Enter",
			def: 1
		}
		],
		bgclose: 1,
	}, options);
	
	const wipe = () => {
		pop.innerHTML = '';
		lastpopclose = _=>{};
	};
	const close = () => {
		_off(window, 'resize', resz);
		_off(document,'keydown', kbd);
		_off(document,'click', bgclick);
		pop_el.style.removeProperty('top');
		_on(pop_el, 'transitionend', wipe);
		pop.classList.remove('popfade');
	};
	
	const bgclick = (e) => {
		if(options.bgclose && !pop_el.contains(e.target)){
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	};
	
	const pressed = async (btn, html) => {
		if (!btn.click) {
			close();
			return;
		}
		
		try {
			if (await btn.click(html, pp)) close();
		} catch (err) {
			console.log(err);
		}
	};
	const kbd = (e) => {
		if(e.key === undefined){return;}
		const key = e.key.toLowerCase();
		const d = options.buttons.find(btn => {return btn.key && btn.key.toLowerCase() === key;});
		if(d){
			e.preventDefault();
			throttle(()=>{
				pressed(d, section);
			},500)();
			return;
		}
		if(key === 'escape'){
			close();
		}
	};
	
	const fbtn = () => {
		options.buttons.forEach(bn => {
			ft.appendChild(_ce('button',{'class': 'btn' + (bn.def ? ' default' : '')},{innerHTML: bn.text, onclick: () => pressed(bn, section)}));
		});
	};
	
	let pop = _id('popup');
	if(!pop){
		pop = _ce('div',{id: 'popup','class': 'notranslate'});
		document.body.appendChild(pop);
	}
	wipe();
	const popl = _ce('div');
	popl.id = 'poplayer';
	pop.appendChild(popl);
	const pop_el = _ce('div',{id: 'popbox'});
	
	const hd = _ce('header',0,{textContent: head});
	pop_el.appendChild(hd);
	
	pop.appendChild(pop_el);
	
	void popl.offsetWidth;
	
	const section = _ce('section');
	if(html instanceof Element){
		section.appendChild(html);
	}else{
		section.innerHTML = html;
	}
	
	section.appendChild(_ce('cite'));
	pop_el.appendChild(section);
	const ft = _ce('footer');
	fbtn();
	pop_el.appendChild(ft);
	
	const resz = () => {
		pop_el.style.top = (window.pageYOffset + Math.max(100,(window.innerHeight - pop_el.offsetHeight) / 2))+'px';
	};
	const pp = {
		head: (h) => { hd.textContent = h;},
		msg: (msg) => { section.innerHTML = msg;},
		btn: (bx) => { options.buttons = bx; ft.innerHTML = ''; fbtn();},
		el: pop,
		close
	};
	
	resz();
	pop.classList.add('popfade');
	resz();
	wait(300,()=>{
		_on(window, 'resize', resz);
		_on(document,'keydown', kbd);
		_on(document,'click', bgclick);
		resz();
	});
	lastpopclose = close;
	return pp;
	
}

const getExt = (t)=>{const o=t.split("/").pop().split(".");return o.length>1?o.pop().toLowerCase():"";};
const ext_zip = new Set(["zip", "tar", "gz", "tgz"]);
const ext_text = new Set(["txt", "md", "yaml", "yml", "jinja", "json", "xml", "csv", "log", "ini", "conf", "cfg", "py", "js", "ts", "php", "htm", "html", "css", "sh"]);
const isText = (e) => e.type !== "dir" && ext_text.has(getExt(e.name));
const isZipFile = (e) => e.type !== "dir" && ext_zip.has(getExt(e.name));
const iconFor = (e) => e.type === "dir" ? "folder" : isZipFile(e) ? "zip" : isText(e) ? "doc" : "file";

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[c]);

const filesize = (s,t='file') => {
	let v = Number(s);
	if (t === "dir") return "-";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
	return v.toFixed(i ? 1 : 0) + " " + units[i];
};

function sidebar(open) {
	const m = _qs('.tabs .menu');
	m.classList[open ? 'add' : 'remove']('hide');
	_id("sidebar").classList[open ? 'remove' : 'add']('closed');
	app.sidebar = open;
}

const getToken = () => {
	let conn = window.hassConnection || window.parent.hassConnection;
	
	if (app.auth) {
		if (app.auth.expires - Date.now() > 0) {
			return Promise.resolve(app.auth.access_token);
		}
		
		if (conn) {
			return conn.then((config) => {
				return config.auth.refreshAccessToken().then(() => {
					app.auth = config.auth.data;
					return app.auth.access_token;
				});
			}).catch((err) => {
				console.error("Refresh failed:", err);
				app.auth = null;
				return '';
			});
		}
	}
	if (conn) {
		return conn.then((config) => {
			app.auth = config.auth.data;
			return app.auth.access_token;
		});
	}
	return Promise.resolve('');
};

async function getEntities(){
	await fetch('/api/states', {headers: await authHeaders()}).then((resp) => {
		if (resp.ok) {
			resp.json().then((data) => {
				app.entities = data
				.map(e => ({
					label: e.entity_id,
					type: "variable",
					detail: String(e.state ?? ""),
					info: e.attributes?.friendly_name || ""
				}))
				.sort((a, b) => a.label.localeCompare(b.label));
			});
		}			
	});	
}

function entityCompletion(context) {
	const word = context.matchBefore(/[a-zA-Z_][\w]*(?:\.[\w]*)?/);
	if (!opt.bulb || !word) return null;
	const typed = word.text.toLowerCase();
	if (typed.length < 3) return null;
	const entities = app.entities || [];
	return {
		from: word.from,
		options: entities.filter(e =>
			e.label.toLowerCase().includes(typed)
		),
		validFor: /^[\w.]*$/
	};
}

let theme = localGet('theme') || 'mode';
const colorMode = () => {
	const btn = _id('theme');
	let c="mode";
	if (btn.classList.contains('ico-mode')) {c = "dark";}
	if (btn.classList.contains('ico-dark')) {c = "light";}
	btn.className = 'ico-'+c;
	localSet("theme",c);
	theme = c;
	checkTheme(true);
};

function checkTheme(manual){
	app.dark = (theme === 'mode') ? !!window.matchMedia?.("(prefers-color-scheme: dark)").matches : (theme === 'dark');
	document.documentElement.classList.toggle("dark", app.dark);
	if(manual){
		if (edit.cm) {
			edit.cm.dispatch({effects: edit.theme.reconfigure(app.dark ? CM.darkTheme : CM.lightTheme)});
		}		
	}
}

function wordWrap(css){
	if(css!==1){
		opt.wrap = (opt.wrap)? null : 1;
		MyConfig(opt);
		edit.cm.dispatch({effects: edit.wrap.reconfigure(opt.wrap ? CM.EditorView.lineWrapping : [])});
	}
	_id('wrapButton').classList.toggle("primary", !!opt.wrap);
}

function spaces(css){
	if(css!==1){
		opt.space = (opt.space)? null : 1;
		MyConfig(opt);
		edit.cm.dispatch({effects: edit.space.reconfigure(opt.space ? CM.highlightWhitespace() : [])});
	}
	_id('spaceButton').classList.toggle("primary", !!opt.space);
}

function extLang(s){
	if(!edit.cm){return;}
	let ext = getExt(tabs.open);
	if(s === 'auto' && edit.ext[ext]){
		s = ext;
	}
	let n = (edit.ext[s])? edit.ext[s]() : [];
	edit.cm.dispatch({ effects: edit.lang.reconfigure(n) });
}

async function validate(){
	const ext = getExt(tabs.open);
	const c = edit.cm.state.doc.toString();
	let r = '';
	if (ext === 'js') {
		try {
			new Function('"use strict";'+c);
		} catch (e) {
			r = e.name + ': '+ e.message;
		}	
	}else if (ext === 'json') {
		try {
			JSON.parse(c);
		} catch (e) {
			r = e.message;
		}	
	}else if(['yaml','yml','py'].includes(ext)){
		r = await apiPost("valid", { ext, content: c});
		if (r.valid) { r = ''; }else{
			r = escapeHtml(r.error)+'<p>line '+ r.line+', column '+r.column+'</p>';
		}
	}else{
		r = 'Unsupported file: '+ext;
	}
	if (r) {
		toast('Error: '+r, { theme: 'red', timeout: 0, close: 1, html: 1 });
	}else{
		toast("No Errors");
	}
}

function autoComp(css){
	if(css!==1){
		opt.bulb = (opt.bulb)? null : 1;
		MyConfig(opt);
	}
	_id('bulbButton').classList.toggle("primary", !!opt.bulb);
}

function txtSize(e=0){
	if(e){
		app.font += e;
		localSet('font', app.font);
		toast(app.font+'%',{timeout: 0.3,theme:'black'});
	}
	edit.cm.dispatch({effects: edit.font.reconfigure(txtSizeGo())});
}

const txtSizeGo = ()=>CM.EditorView.theme({'&': {fontSize: app.font + '%'}});

async function authHeaders(extra) {
	const headers = extra || {};
	return getToken().then((token) => {
		if (token) {
			headers.Authorization = "Bearer " + token;
		}
		return headers;
	});
}

function apiUrl(path, params) {
	const u = new URL(path, window.location.origin);
	
	Object.keys(params || {}).forEach((key) => {
		if (params[key] !== undefined && params[key] !== null) {
			u.searchParams.set(key, params[key]);
		}
	});
	
	return u.toString();
}


async function apiMsg(res){
	let d = {};
	try {
		d = await res.json();
	} catch (e) {
		const m = `HTTP ${res.status}: ${res.statusText}`;
		toast(`Error: ${m}`, {theme: 'red'});
		throw new Error(m);
	}
	
	if (res.ok && d.ok) {return d;}
	
	const m = d.error || d.message || `HTTP ${res.status}`;
	toast(`Error: ${m}`, {theme:'red'});
	throw new Error(m);		
}

async function apiPost(act, body) {
	const u = apiUrl("/api/file_shell", { action: act });
	let content = {
		method: "POST",
		headers: await authHeaders({"Content-Type": "application/json"}),
		body: JSON.stringify(body)
	};
	let res = await fetch(u, content);
	
	if (res.status === 401) {
		app.auth = null;
		content.headers = await authHeaders({"Content-Type": "application/json"});
		res = await fetch(u, content);
	}
	
	return await apiMsg(res);
}

function fixpath(p) {
	if (!p || p === "") return "/";
	return "/" + p.split('/').filter(Boolean).join('/');
}

function getparent(p) {
	p = fixpath(p);
	if (p === "/") return "/";
	const s = p.split("/").filter(Boolean);
	s.pop();
	return "/" + s.join("/");
}

function displayPath(p) {
	return escapeHtml(fixpath(p));
}

function entryPath(e) {
	return fixpath(app.curDir + "/" + e.name);
}


function buildTabs() {
	let t = _id('tabs');
	t.innerHTML = '';
	t.appendChild(_ce('button',{title:'Menu', class: 'menu ico-menu'},{onclick: _=> sidebar(!app.sidebar)}));
	sidebar(app.sidebar);
	let d = app.curDir.split('/').pop();
	[
		['favs', 'Favorites', 'ico-star'],
		['files', d, 'ico-folder'],
		['uploads', 'Uploads', 'ico-upload'],
	].forEach(([id, text, icon]) => {
		if (!app[id]) { return; }
		t.appendChild(_ce('div', {title: text?text:'Home', class: 'tab t'+id+ (tabs.open === id ? ' active' : '')},{onclick: () => switchToTab(id)},[
			_ce('i',{class: icon}),
			_ce('span',{class: text?'':'ico-home'},{textContent: text}),
			(['favs','files'].includes(id))? null : _ce('span', { class: 'ico-x' }, { onclick: (e) => {
				e.stopPropagation();
				closeTab(id);
			} }),
		]
		));
	});
	


	for (const id of tabs.terms) {
		const session = app.terms[id];
		t.appendChild(_ce('div', {title: 'Terminal: '+(session?session.cwd:'/'), class: 'tab tcmd'+ (tabs.open === id ? ' active' : '')},{onclick: () => switchToTab(id)},[
			_ce('i',{class: 'ico-cmd'}),
			_ce('span',0,{textContent: session?session.title:'Terminal'}),
			_ce('span', { class: 'ico-x' }, { onclick: (e) => {
				e.stopPropagation();
				closeTab(id);
			}}),
		]));
	}

	for (const id of tabs.list) {
		t.appendChild(_ce('div', {class: 'tab '+ (tabs.open === id ? 'active' : '')},{textContent: id.split('/').pop(), onclick: () => switchToTab(id)},
			_ce('span', { class: 'ico-x' }, { onclick: (e) => {
				e.stopPropagation();
				closeTab(id);
			}})
		));
	}
}

function switchToTab(tabId) {
	if (tabId === tabs.open) return;
	if (tabs.open && !tabs.fixed.includes(tabs.open) && !isTermTab(tabs.open)) {
		tabs.x[tabs.open].cm = edit.cm.state;
		const r = edit.cm.scrollDOM;
		tabs.x[tabs.open].scr = { top: r.scrollTop, left: r.scrollLeft };
	}
	if (isTermTab(tabs.open) && app.terms[tabs.open]) {
		app.terms[tabs.open].pane.style.display = 'none';
	}	
	tabs.open = tabId;
	
	_qs('body').classList.remove('edit', 'cmd', ...tabs.fixed);
	if (isTermTab(tabId)) {
		_qs('body').classList.add('cmd');
		const session = app.terms[tabId];
		if (session) {
			session.pane.style.display = 'flex';
			session.fit.fit();
			session.term.focus();
		}
	} else if (tabs.fixed.includes(tabId)) {
		_qs('body').classList.add(tabId);
	} else {
		edit.cm.setState(tabs.x[tabId].cm);
		
		const s = tabs.x[tabId].scr;
		if (s) edit.cm.scrollDOM.scrollTo(s.left, s.top);
		
		const e = tabs.x[tabId].lang;
		_qs('#CMLang select').value = e;
		extLang(e);

		edit.cm.dispatch({
			effects: [
				edit.theme.reconfigure(app.dark ? CM.darkTheme : CM.lightTheme),
				edit.wrap.reconfigure(opt.wrap ? CM.EditorView.lineWrapping : []),
				edit.space.reconfigure(opt.space ? CM.highlightWhitespace() : []),
				edit.font.reconfigure(txtSizeGo()),
			]
		});
		
		const d = _id('draftButton');
		d.classList.add('hide');
		if(tabs.x[tabId].draft!==null){
			d.classList.remove('hide');
		}
		_qs('body').classList.add('edit');
	}
	buildTabs();
}


async function closeTab(id, force=0) {
	if (id === 'uploads'){
		uploadui(1);
		buildTabs();
		return;
	}
	if (isTermTab(id)) {
		app.terms[id]?.wipe();
		const idx = tabs.terms.indexOf(id);
		if (idx !== -1) tabs.terms.splice(idx, 1);
		if (tabs.open === id) {
			tabs.open = null;
			switchToTab(tabs.terms[Math.max(0, idx - 1)] || 'files');
		}
		buildTabs();
		return;
	}	
	const t = tabs.x[id];
	if (!force && t.org !== t.mod && t){
		popup(_ce('p',0,{textContent:'Close without saving?'}), id.split('/').pop() + ' Changed', {buttons: [
			{text: "No",key: "Escape"},
			{text: 'Yes',key: "Enter",def: 1,click: () => {closeTab(id,1);return true;}}
		]});
		switchToTab(id);
		return;
	}
	
	const idx = tabs.list.indexOf(id);
	if (idx === -1 || !t) return;
	tabs.list.splice(idx, 1);
	delete tabs.x[id];
	tabs.open = null;
	if (tabs.list.length === 0) {
		if (edit.cm) {
			edit.cm.destroy();
			edit.cm = null;
		}
		els.edit.innerHTML = "";
		_qs('#CMLang select').value = 'auto';
		switchToTab('files');
	} else {
		const n = tabs.list[Math.max(0, idx - 1)];
		switchToTab(n);
	}
	buildTabs();
}



function Draft(path, d=false) {
	const k = "draft_"+encodeURIComponent(path);
	if(d === false){
		return localGet(k);
	}
	return localSet(k, d);
}

async function openTextFile(e) {
	const path = fixpath(e.path);
	hideMenu();
	
	if (tabs.x.hasOwnProperty(path)) {
		switchToTab(path);
		return;
	}
	
	let text = await apiPost("read",{path: path});
	text = text.content;
	if(!tabs.x[path]){
		tabs.x[path]={
			draft: null,
			org: text,
			mod: text,
			lang: 'auto',
			cm: null,
			scr: {top: 0, left: 0},
		};
	}
	
	const btndraft = _id('draftButton');
	const draft = Draft(path, false);
	if(draft && draft !== text){
		tabs.x[path].draft = draft;
		btndraft.classList.remove('hide');
		toast("Click to restore Auto saved content of this file",{theme:'red',click: ()=>{_id('draftButton').click();return true;}});
	}else{
		btndraft.classList.add('hide');
	}
	

	const fileExt = getExt(path);

	tabs.x[path].cm = CM.EditorState.create({
		doc: text,
		extensions: [
			CM.basicSetup,
			CM.keymap.of([CM.indentWithTab]),
			CM.search(),
			CM.autocompletion(),
			CM.EditorState.languageData.of(() => [{autocomplete: entityCompletion}]),
			edit.theme.of(app.dark ? CM.darkTheme : CM.lightTheme),
			edit.lang.of(edit.ext[fileExt] ? edit.ext[fileExt]() : []),
			edit.wrap.of(opt.wrap ? CM.EditorView.lineWrapping : []),
			edit.space.of(opt.space ? CM.highlightWhitespace() : []),
			edit.font.of(txtSizeGo()),
			CM.EditorView.updateListener.of((u) => {
				if (u.docChanged) {
					const t = u.state.doc.toString();
					tabs.x[path].mod = t;
					Draft(path, t);
				}
			})
		]
	});
	
	tabs.list.push(path);
	
	if (!edit.cm) {
		els.edit.innerHTML = "";
		edit.cm = new CM.EditorView({
			state: tabs.x[path].cm,
			parent: els.edit
		});
	} else {
		edit.cm.setState(tabs.x[path].cm);
	}
	
	tabs.open = path;
	extLang('auto');
	
	_qs('body').classList.remove('cmd', ...tabs.fixed);
	_qs('body').classList.add('edit');
		
	const s = tabs.x[path].scr;
	if(s){edit.cm.scrollDOM.scrollTo(s.left, s.top);}
	
	sidebar(0);
	app.find = 0;
	
	buildTabs();
}



async function saveTextFile() {
	if (tabs.fixed.includes(tabs.open) || isTermTab(tabs.open) || !edit.cm) return;
	const p = tabs.open;
	if (!p) return;
	const c = edit.cm.state.doc.toString();
	await apiPost("save", { path: p, content: c, existing: true });
	const t = tabs.x[p];
	t.org = t.mod = c;
	Draft(p, null);
	
	toast("Saved " + displayPath(p));
}










async function loadDir(path) {
	switchToTab('files');
	const t = fixpath(path.replace(/^\.+|\.+$/g, ""));
	app.sel = {};
	hideMenu();
	const data = await getDir(t);
	app.curDir = fixpath(t);
	app.entries = (data || []);
	app.cache.set(app.curDir, app.entries);
	app.openDirs.add(app.curDir);
	buildTabs();
	buildList();
	buildTree();
	return true;
}


function buildList() {
	els.files.innerHTML = "";
	const entries = app.entries;
	
	const sorted = entries.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === "dir" ? -1 : 1;
		}
		
		let A, B;
		switch (app.sortBy) {
			case "size":
				A = a.size || 0;
				B = b.size || 0;
				break;
			case "date":
				A = a.mtime || 0;
				B = b.mtime || 0;
				break;
			case "name":
			default:
				A = String(a.name).toLowerCase();
				B = String(b.name).toLowerCase();
				break;
		}
		
		let c = typeof A === "string" ? A.localeCompare(B) : A - B;
		return app.sortOrder === "asc" ? c : -c;
	});
	
	const ad = {asc:'<i>▲</i>',desc:'<i>▼</i>'};
	const adtx = (type) => app.sortBy === type ? ad[app.sortOrder] : "";
	
	const clsort = (type) => {
		if (app.sortBy === type) {
			app.sortOrder = app.sortOrder === "asc" ? "desc" : "asc";
		} else {
			app.sortBy = type;
			app.sortOrder = "asc";
		}
		buildList();
	};
	
	const tbody = _ce("tbody");
	
	if (app.curDir !== "/") {
		tbody.appendChild(
			_ce("tr", { class: "c" }, { onclick: () => {
					if(app.cmenu){return hideMenu();}
					loadDir(getparent(app.curDir));
				} }, [
				(app.multi ? _ce("td", 0, 0) : null ),
				_ce("td", 0, 0,[
					_ce('i',{class:'ico-folder'}),
					_ce('strong', 0, {textContent: ".."})
				]),
				_ce("td"),
				_ce("td")
			])
		);
	}
	let ticked = 0; let tot = 0;
	for (const e of sorted) {
		const dt = new Date(e.mtime).toLocaleString('en-GB', { hour12: false });
		if(app.sel[e.path]){ticked++;}
		tot++;
		let x = (e.type === "dir" || isText(e))? 'c' : 'n';
		const row = _ce("tr", {"data-sel": (app.sel[e.path]? '1': '0'), class: x}, {
			onclick: () => {
				if(app.cmenu){return hideMenu();}
				if (e.type === "dir") {
					loadDir(entryPath(e));
				}
				if(isText(e)){
					openTextFile(e);
				}
			},
			oncontextmenu: (q) => {
				q.preventDefault();
				q.stopPropagation();
				showContextMenu(q.clientX, q.clientY, e, row);
			}
			}, [
			(app.multi ? _ce("td", {class:"tick"}, { onclick: (q) => {
				q.stopPropagation();
				let d='1'; const p = q.target.parentNode;
				if(app.sel[e.path]){
					d='0';
					delete app.sel[e.path];
				}else{
					app.sel[e.path]=e;
				}
				_att(p,'data-sel',d);
			} }) : null ),
			
			_ce("td", 0, 0, [
				_ce('i',{class:'ico-'+iconFor(e)}),
				_ce('span',0,{textContent: e.name})
			]),
			_ce("td", {class:'right'}, { textContent: filesize(e.size, e.type) }),
			_ce("td", 0, { textContent: dt })
		]);
		
		tbody.appendChild(row);
	}
	
	const table = _ce("table", {class: 'exp'}, 0, [
		_ce("thead", 0, 0, [
			_ce("tr", {"data-sel": (ticked<tot? '0': '1')}, 0, [
				((app.multi) ? _ce("th", {class:"tick"}, { onclick: () => {
					const add = ticked<tot;
					for (const entry of sorted) {
						if(add){app.sel[entry.path]=entry;ticked++;}else{delete app.sel[entry.path];ticked--;}
					}
					buildList();
				} }) : null ),
				_ce("th", 0, { innerHTML: "Name" + adtx("name"), onclick: () => clsort("name") }),
				_ce("th", {class:'right'}, { innerHTML: "Size" + adtx("size"), onclick: () => clsort("size") }),
				_ce("th", 0, { innerHTML: "Date" + adtx("date"), onclick: () => clsort("date") })
			])
		]),
		tbody
	]);
	
	els.files.appendChild(table);
	els.files.className = "";
}

async function getTreeEntries(path) {
	path = fixpath(path);
	if (app.cache.has(path)) {
		return app.cache.get(path);
	}
	const e = await getDir(path);
	app.cache.set(path, e);
	return e;
}

function buildTree() {
	els.tree.innerHTML = "";
	const root = _ce("ul", { class: "level" });
	els.tree.appendChild(root);
	buildTreeNode("/", root).catch(showError);
}

async function buildTreeNode(path, parentEl) {
	path = fixpath(path);
	const expanded = app.openDirs.has(path);
	const name = path === "/" ? "/" : path.split("/").filter(Boolean).pop();
	const active = path === app.curDir;

	const row = _ce("div", { class: 'item '+ (active ? " active" : "") }, {
		onclick: () => {
			if(app.cmenu){return hideMenu();}
			loadDir(path);
		},
		oncontextmenu: (e) => {
			e.preventDefault();
			e.stopPropagation();
			showContextMenu(e.clientX, e.clientY, { name, path, type: "dir" }, row);
		}
	},
	[
		_ce("span", {class: 'toggle '+(expanded ? "open ico-down" : "ico-side")}, {onclick:(e) => {
			if(app.cmenu){return hideMenu();}
			e.stopPropagation();
			if (app.openDirs.has(path)){
				app.openDirs.delete(path);
			}else{
				app.openDirs.add(path);
			}
			buildTree();
		}}),
		_ce('i',{class: active ? "ico-ofolder" : "ico-folder"}),
		_ce("span", 0, { textContent: name })
	]);
	
	const li = _ce("li", { class: "node" }, 0, [row]);
	parentEl.appendChild(li);
	
	if (!expanded) return;
	
	const d = await getTreeEntries(path);
	const dirs = d.filter(e => e.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
	
	if (!dirs.length) return;
	
	const c = _ce("ul", { class: "level" });
	li.appendChild(c);
	for (const f of dirs) {
		await buildTreeNode(fixpath(path + (path.endsWith("/") ? "" : "/") + f.name), c);
	}
}

async function createNewFile(entry) {
	const path = entry?.path || app.curDir;
	const input = _ce("input", {type: "text", class: "name-input", placeholder: "New file name"});
	
	const create = async (html, pp) => {
		const name = input.value.trim();
		
		if (!name) {
			_qs('cite', html).textContent = "Missing file name";
			input.focus();
			return false;
		}
		
		if (!name.match(/^[^\\/:*?"<>|]+$/)) {
			_qs('cite', html).textContent = "Invalid file name";
			input.focus();
			return false;
		}
		
		try {
			await apiPost("save", {
				path: fixpath(path + "/" + name),
				content: "",
				existing: false
			});
			await loadDir(app.curDir);
			toast("Created " + name);
			return true;
		} catch (err) {
			toast(`Failed: ${err.message}`);
			return true;
		}
	};
	
	popup(_ce("div", 0, 0, [_ce("label", 0, { textContent: "File name:" }), input]), "New File", {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Create", key: "Enter", def: 1, click: create}
	]});
	
	input.focus();
}


function downloadFile(path) {
	const t = fixpath(path);
	const url = apiUrl("/api/file_shell_stream", {
		action: "download",
		path: t,
		authorization: app.auth.access_token
	});
	const l = _ce("a",{href: url, download: t.split("/").pop()});
	document.body.appendChild(l);
	l.click();
	l.remove();
	toast("Download started: " + displayPath(t));
}




async function createFolder(e) {
	const path = e?.path || app.curDir;
	const input = _ce("input", {type: "text", style: 'width: 90%'});
	const create = async (html) => {
		const name = input.value.trim();
		if (!name) return true;
		
		try {
			await apiPost("mkdir", {path: path, name: name});
			await loadDir(app.curDir);
			toast("Created folder " + name);
			return true;
		} catch (err) {
			_qs('cite', html).textContent = `Failed: ${err.message}`;
			input.focus();
			return false;
		}
	};
	
	popup(_ce('p',0,{innerHTML: "New folder name:<br>"},[input, _ce('p',0,{textContent: '@ '+path})]), "Create Folder", {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Create", key: "Enter", def: 1, click: create}
	]});
	input.focus();
	input.select();
}




async function renameEntry(e) {
	const input = _ce("input", {type: "text", style: 'width: 90%', value: e.name});
	const rename = async (html) => {
		const newName = input.value.trim();
		if (!newName || newName === e.name) return true;
		
		try {
			await apiPost("rename", {path: e.path, new_name: newName});
			await loadDir(app.curDir);
			toast("Renamed to " + newName);
			return true;
		} catch (err) {
			console.log(err);
			_qs('cite', html).textContent = `Failed: ${err.message}`;
			input.focus();
			return false;
		}
	};
	popup(_ce('p',0,0,input), "Rename "+e.name, {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Rename", key: "Enter", def: 1, click: rename}
	]});
	input.focus();
	input.select();
}





async function deleteEntry(entry) {
	let p = Object.keys(app.sel);
	let i = p.length + " items";
	
	if (!p.length) {
		if (!entry) return;
		p = [entry.path];
		i = displayPath(entry.path);
	}
	
	popup(_ce("div", 0, 0, [
		_ce("p", 0, { textContent: "Delete " + i + "?" }),
		_ce("p", { class: "danger" }, { textContent: "This cannot be undone." })
	]), "Confirm Delete", {
	bgclose: 1,
	buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Delete", key: "Enter", def: 1, click: async (html) => {
			try {
				const data = await apiPost("delete", { paths: p });
				await loadDir(app.curDir);
				toast("Deleted " + data.deleted);
			} catch (err) {
				toast(`Failed: ${err.message}`,{theme: 'red'});
			}
			return true;
		}}
	]
	});
}




async function createLink(entry, blank) {
	const input = _ce("input", {type: "text", style: 'width: 90%', value: blank ? "" : "Link to " + entry.name});
	const path = _ce("input", {type: "text", style: 'width: 90%', value: blank ? "" : entry.path});
	const create = async (html) => {
		const name = input.value.trim();
		
		if (!name || name.includes('/') || name === '' || name === '.' || name === '..') {
			_qs('cite', html).textContent = "Invalid link name";
			input.focus();
			return false;
		}
		
		const target = path.value.trim();
		
		if (!target) {
			_qs('cite', html).textContent = "Invalid Target";
			path.focus();
			return false;
		}
		const symlinkPath = fixpath(getparent(entry.path) + '/' + name);
		
		try {
			await apiPost("symlink", { path: symlinkPath, target: target });
			
			await loadDir(app.curDir);
			toast(`Created symlink ${name} → ${target}`);
			return true;
		} catch (err) {
			_qs('cite', html).textContent = `Failed: ${err.message}`;
			return false;
		}
	};
	
	popup(_ce('p',0,0,[_ce('p',0,{innerHTML: 'Link name:<br>'},input),_ce('p',0,{innerHTML: 'Target path (absolute or relative to this folder):<br>'},path)]), "Create Link", {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Create", key: "Enter", def: 1, click: create}
	]});
	
	input.focus();
	input.select();
}



async function createZip(entry) {
	hideMenu();
	let p = Object.keys(app.sel);
	let i = p.length + " items";
	if(!p.length){
		if (!entry) return;
		p = [entry.path];
		i = displayPath(entry.path);
	}
	
	toast("Creating zip for " + i + "...");
	const d = await apiPost("zip", {paths: p});
	await loadDir(app.curDir);
	toast("Created zip " + displayPath(d.path));
}

async function extractZip(entry) {
	if (!isZipFile(entry)) return;
	toast("Extracting " + displayPath(entry.path) + "...");
	const data = await apiPost("extract", {path: entry.path});
	await loadDir(app.curDir);
	toast("Extracted " + data.extracted + " item(s) from " + entry.name);
}




async function showProperties(entry) {
	let info;
	try {
		const data = await apiPost("stat", { path: entry.path });
		info = data.info;
	} catch (err) {
		toast(`Failed to get properties: ${err.message}`);
		return;
	}
	
	const isSymlink = info.symlink;
	const fullOctal = info.mode.toString(8).slice(-4);
	const bits = [4, 2, 1];
	const rows = [
		["Special", "UID", "GID", "Sticky"],
		["Owner", "R", "W", "X"],
		["Group", "R", "W", "X"],
		["Other", "R", "W", "X"]
	];
	
	const getBit = (oct, row, col) => !!(parseInt(oct[row], 10) & bits[col]);
	const boxes = [];
	const buildOctal = () => boxes.map(row => row.reduce((v, cb, j) => v + (cb.checked ? bits[j] : 0), 0)).join("");
	
	let octalInput;
	
	const perm = [];
	rows.forEach(([label, ...labels], i) => {
		const row = [];
		perm.push(_ce("div", 0, { textContent: label }));
		labels.forEach((txt, j) => {
			const cb = _ce("input", { type: "checkbox" }, {
				checked: getBit(fullOctal, i, j),
				onchange: () => {
					octalInput.value = buildOctal();
				}
			});
			
			perm.push(_ce("label", 0, 0, [cb, _tn(txt)]));
			row.push(cb);
		});
		
		boxes.push(row);
	});
	
	octalInput = _ce("input", {
		type: "text",
		class: "guid",
		value: fullOctal
		}, {
		oninput: e => {
			let val = e.target.value.replace(/[^0-7]/g, "").slice(-4);
			if (val.length < 4) val = val.padStart(4, "0");
			e.target.value = val;
			
			for (let i = 0; i < 4; i++) {
				for (let j = 0; j < 3; j++) {
					boxes[i][j].checked = getBit(val, i, j);
				}
			}
		}
	});
	
	const iowner = _ce("input", {
		type: "text",
		class: "guid",
		placeholder: info.owner,
		value: info.owner,
	});
	
	const igroup = _ce("input", {
		type: "text",
		class: "guid",
		placeholder: info.group,
		value: info.group,
	});
	
	const targetInput = _ce("input", {
		type: "text", style: "width: 80%;",
		value: isSymlink || ""
	});
	
	const body = _ce("div", 0, 0, [
		_ce("p", 0, { textContent: "Path: " + entry.path }),
		isSymlink ? _ce("p", 0, 0, [
			_ce("span", 0, { textContent: "Link to:" }),
			targetInput
		]) : null,
		_ce("p", 0, { textContent: "Size: " + filesize(entry.size, entry.type) }),
		_ce("p", 0, { textContent: "Modified: " + new Date(entry.mtime).toLocaleString() }),
		
		_ce("p", 0, { textContent: "Permissions" }),
		_ce("div", { style: "display: grid;grid-template-columns: 70px repeat(3, 70px);gap: 8px;align-items: center;margin-top: 8px" }, 0, perm),
		_ce("div", { style: "display: flex; gap: 12px; margin-top: 12px; align-items: center;" }, 0, [
			_ce("span", 0, { textContent: "Octal:" }),
			octalInput
		]),
		
		_ce("p", 0, 0, [
			_ce("label", 0, { innerHTML: "Owner: " }, iowner),
			_ce("label", 0, { innerHTML: "Group: " }, igroup),
		])
	]);
	const cc = async (html) => {
		const newOctal = octalInput.value;
		const owner = iowner.value;
		const group = igroup.value;
		const update = {};
		
		try {
			if (isSymlink) {
				const newTarget = targetInput.value;
				if (newTarget !== info.symlink) {
					await apiPost("symlink", {
						path: entry.path,
						target: newTarget
					});
				}
			}
			
			if (newOctal !== fullOctal) update.mode = newOctal;
			if (owner !== info.owner || group !== info.group){
				update.owner = owner;
				update.group = group;
			}
			
			if (Object.keys(update).length) {
				await apiPost("chmod", {
					path: entry.path,
					...update
				});
			}
			
			toast("Properties updated");
			await loadDir(app.curDir);
			return true;
		} catch (err) {
			_qs('cite', html).textContent = `Failed: ${err.message}`;
			return false;
		}
	};
	popup(body, "Properties: " + entry.name, {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: "Save", key: "Enter", def: 1, click: cc}
	]});
}

async function getDir(fullpath) {
	const data = await apiPost("list", { path: fullpath });
	return (data.entries || []).map(entry => ({
		...entry,
		path: fixpath(fullpath + "/" + entry.name)
	}));
}


async function targetPick(entry, isCopy = false) {
	let p = Object.keys(app.sel);
	let i = p.length + " items";
	if (!p.length) {
		if (!entry) return;
		p = [entry.path];
		i = displayPath(entry.path);
	}
	
	const action = isCopy ? "Copy" : "Move";
	
	folderPick(app.curDir, action+' '+i, action, async (dest) => {
		if (!dest) return false;
		toast(action+' '+i+' → '+dest+'...');
		await apiPost(isCopy ? "copy" : "move", {
			paths: p,
			destination: dest
		});
		toast(action+' Done: '+dest);
		await loadDir(app.curDir);
		return true;
	});
}




async function folderPick(root,header,button,click) {

	
	const box = _ce("div");
	
	const pp = popup(box, header, {buttons: [
		{text: "Cancel", key: "Escape"},
		{text: button, key: "Enter", def: 1, click: () => click(box.dataset.path)}
	]});
	
	const render = async (path) => {
		path = fixpath(path);
		box.dataset.path = path;
		
		const data = await getDir(path);
		const fo = (data || []).filter(f => f.type === "dir");
		
		box.innerHTML = "";
		
		box.appendChild(_ce("div", { class: "muted" }, {textContent: "Choose a folder"}));
		
		box.appendChild(_ce("div", { class: "pick-nav" }, null, [
			_ce("button", null, {textContent: "Root", onclick: () => render("/")}),
			_ce("button", null, {textContent: "Up", onclick: () => render(getparent(path))}),
			_ce("span", { class: "pick-path" }, {textContent: path})
		]));
		
		const list = _ce("div", { class: "pick-list" });
		
		if (fo.length) {
			fo.forEach(f => {
				list.appendChild(_ce("div", { class: "pick-item" }, {
					onclick: () => render(f.path)
					},[
					_ce('i',{class: "ico-folder"}),
					_ce('span',0,{textContent:f.name})
				]));
			});
		} else {
			list.appendChild(_ce("div", { class: "muted" }, {
				textContent: "No folders here"
			}));
		}
		
		box.appendChild(list);
	};
	
	await render(root);
}




const menuact = {
	refresh: (e) => loadDir(app.curDir),
	mkdir: (e) => createFolder(e),
	newfile: (e) => createNewFile(e),
	open: (e) => loadDir(e.path),
	edit: (e) => openTextFile(e),
	download: (e) => downloadFile(e.path),
	rename: (e) => renameEntry(e),
	delete: (e) => deleteEntry(e),
	zip: (e) => createZip(e),
	extract: (e) => extractZip(e),
	move: (e) => targetPick(e, false),
	copy: (e) => targetPick(e, true),
	chmod: (e) => showProperties(e),
	createlink: (e) => createLink(e,0),
	newlink: (e) => createLink(e,1),
	favadd: (e) => addFav(e),
	favrem: (e) => removeFav(e),
	folder: (e) => loadDir(getparent(e.path)),
};


function buildMenu(x, y, m, entry, callback) {
	_qs('body').classList.add('cmenu');
	els.cmenu.innerHTML = "";
	m.forEach(([id, text, icon]) => {
		const isfav = (entry && opt.favs[entry.path]);
		
		if ((id === 'favadd' && isfav)|| (tabs.open !== 'favs' && id === 'favrem' && (!entry || !opt.favs[entry.path]))){return;}
		els.cmenu.appendChild(
			_ce('div',0,{onclick: (e) => {e.stopPropagation(); callback(id);}},[
				_ce('i',{class: icon || ""}),
				_ce("span", 0, {textContent: text})
			])
		);
	});
	
	_att(els.cmenu,'style','display: block;');
	const rect = els.cmenu.getBoundingClientRect();
	_att(els.cmenu,'style','display: block;left:'+Math.max(4,Math.min(x, window.innerWidth - rect.width - 4)) + 'px; top: '+Math.max(4,Math.min(y, window.innerHeight - rect.height - 4))+ 'px' );
	app.cmenu = 1;
	window.getSelection().removeAllRanges();
}


function showFavMenu(x, y, e, row) {
	if (row) row.classList.add("rclick");
	const m = [
		["favadd", "Add to Favorites", 'ico-star'],
		["favrem", "Remove Favorites", 'ico-nostar'],
		["folder", "Open Containing Folder", 'ico-ofolder'],
	];

	if (e.type === "dir") {
		m.push(["open", "Open", 'ico-check']);
	}
	if (e.type === "file") {
		m.push(
			["edit", "Edit", 'ico-text'],
			["download", "Download", 'ico-download']
		);
	}
	m.push(
		['chmod', 'Properties', 'ico-info']
	);
	buildMenu(x, y, m, e, (a) => {
		const c = menuact[a];
		if (c) {
			hideMenu();
			c(e);
		}
	});
}


function showContextMenu(x, y, e, row) {
	hideMenu();
	if (row) row.classList.add("rclick");
	
	const m = [];
	const sels = Object.keys(app.sel);
	if(sels.length){
		m.push(
			['x', sels.length + ' Items', 'ico-menu ok'],
			['zip', 'Create Zip', 'ico-zip'],
			['copy', 'Copy to...', 'ico-copy'],
			['move', 'Move to...', 'ico-move'],
			['delete', 'Delete', 'ico-delete danger'],
		);
	}else{
		m.push(
			["favadd", "Add to Favorites", 'ico-star'],
			["favrem", "Remove Favorites", 'ico-nostar'],
		);
		if (e.type === "dir") {
			m.push(
				["open", "Open", 'ico-check'],
				["zip", "Create Zip", 'ico-zip']
			);
		}
		if (e.type === "file") {
			m.push(
				["edit", "Edit", 'ico-text'],
				["download", "Download", 'ico-download']
			);
			if (isZipFile(e)) {
				m.push(["extract", "Extract Here", 'ico-zip']);
			}
		}
		m.push(
			['copy', 'Copy to...', 'ico-copy'],
			['move', 'Move to...', 'ico-move'],
			['createlink', 'Create Link', 'ico-link'],
			['rename', 'Rename', 'ico-rename'],
			['delete', 'Delete', 'ico-delete danger'],
			['chmod', 'Properties', 'ico-info']
		);
	}
	buildMenu(x, y, m, sels.length? null : e, (a) => {
		const c = menuact[a];
		if (c) {
			hideMenu();
			c(e);
		}
	});
}


function dirContext(x, y) {
	const m = [
		['refresh', 'Refresh', 'ico-refresh'],
		['newfile', 'New File', 'ico-newfile'],
		['mkdir', 'New Folder', 'ico-newdir'],
		['newlink', 'New Link', 'ico-link'],
	];
	buildMenu(x, y, m, null, (a) => {
		const c = menuact[a];
		if (c) {
			hideMenu();
			c({ path: app.curDir }).catch(showError);
		}
	});
}	



function hideMenu() {
	_att(els.cmenu,'style','');
	els.cmenu.innerHTML = "";
	_qsa('.rclick',document).forEach(n=>{n.classList.remove('rclick');});
	app.cmenu = 0;
	_qs('body').classList.remove('cmenu');
}

function showError(err) {
	console.log('error',err);
	toast(err.message || String(err), {theme: 'red'});
}






function addFav(e) {
	opt.favs[e.path] = {...e};
	MyConfig(opt);
	favList(0);
}
function removeFav(e) {
	delete opt.favs[e.path];
	MyConfig(opt);
	favList(0);
}

function favList(swt) {
	els.favs.innerHTML = "";
	const ff = Object.values(opt.favs);
	const tbody = _ce("tbody");
	for (const e of ff) {
		let x = (e.type === "dir" || isText(e))? 'c' : 'n';
		const row = _ce("tr", {"data-sel": 0, class: x}, {
			onclick: () => {
				if (e.type === "dir") {
					loadDir(e.path);
				}
				if(isText(e)){
					openTextFile(e);
				}
			},
			oncontextmenu: (q) => {
				q.preventDefault();
				q.stopPropagation();
				showFavMenu(q.clientX, q.clientY, e, row);
			}
			}, [
			_ce("td", 0, 0, [
				_ce('i',{class:'ico-'+iconFor(e)}),
				_ce('span',0,{textContent: e.path})
			]),
		]);
		tbody.appendChild(row);
	}
	const table = _ce("table", {class: 'exp'}, 0, [
		_ce("thead", 0, 0, [
			_ce("tr", {"data-sel": 0}, 0, [
				_ce("th", 0, { innerHTML: "Name"})
			])
		]),
		tbody
	]);
	
	els.favs.appendChild(table);
	els.favs.className = "";
	if(swt){switchToTab('favs');}
}


function terminal(cwd) {
	sidebar(0);
	const open = () => {
		const id = TERM_PREFIX + (++app.termSeq);
		app.terms[id] = { title: termTitle(cwd), cwd: cwd || '/' };
		tabs.terms.push(id);
		_term(id, cwd);
		switchToTab(id);
	};
	if (window.Terminal) { open(); return; }
	document.body.appendChild(_ce('script',0,{src: './xterm.js'+location.search, onload: open}));
}
function _term(id, cwd){
	const pane = _ce('div', {class: 'term-pane', style: 'display:none;height:100%;flex-direction:column;'});
	els.term.appendChild(pane);

	const term = new Terminal({ cursorBlink: true });
	const fit = new FitAddon();
	const encoder = new TextEncoder();
	let ws = null;
	let cleaned = 0;
	let timer_sec = null;
	let conn = 0;
	let msg = 0;
	
	term.loadAddon(fit);
	term.open(pane);
	const r_fit = new ResizeObserver(() => fit.fit());
	r_fit.observe(pane);
	const onWinResize = () => fit.fit();
	_on(window, 'resize', onWinResize);

	const status = (t) => {
		term.write((msg ? '\r\x1b[2K' : '\r\n') + t);
		msg = 1;
	};
	const send = (data) => {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(data);
		}
	};
	const cl_int = () => {
		if (timer_sec) clearInterval(timer_sec);
		timer_sec = null;
		conn = 0;
	};
	const dc = (s) => {
		status(`\x1b[33mDisconnected. Press any key to reconnect now, or wait ${s}s...\x1b[0m`);
	};
	const reconnect = () => {
		if (cleaned || conn) return;
		conn = 1;
		let s = 9;
		dc(10);
		timer_sec = setInterval(() => {
			s--;
			if (s < 0){cl_int();connect();} else {dc(s);}
		}, 1000);
	};
	const connect = async () => {
		if (cleaned) return;
		status('\x1b[36mConnecting... \x1b[0m');
		try {
			const token = await getToken();
			const q = '?token='+encodeURIComponent(token)+(cwd ? '&cwd='+encodeURIComponent(cwd) : '');
			ws = new WebSocket(location.protocol.replace('http','ws') + '//'+location.host+'/api/file_shell_terminal'+q);
			ws.binaryType = 'arraybuffer';
			ws.onopen = () => {
				term.write('\x1b[32mConnected\r\n\x1b[0m');
				send(JSON.stringify({ resize: [term.cols || 80, term.rows || 24] }));
			};
			ws.onmessage = e => {
				if (!cleaned){
					term.write(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : String(e.data));
				}
			};
			ws.onclose = () => {reconnect();};
			ws.onerror = () => {try { ws.close(); } catch (_) {}};
		} catch (_) {
			reconnect();
		}
	};
	const t_data = term.onData(data => {
		if (conn) {cl_int(); connect(); return;}
		send(encoder.encode(data));
	});
	const t_rsz = term.onResize(({ cols, rows }) => {send(JSON.stringify({ resize: [cols, rows] }));});
	const wipe = () => {
		if (cleaned) return;
		cleaned = 1;
		cl_int();
		try { t_data.dispose(); } catch (_) {}
		try { t_rsz.dispose(); } catch (_) {}
		try { r_fit.disconnect(); } catch (_) {}
		_off(window, 'resize', onWinResize);
		if (ws) {
			ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
			try { ws.close(); } catch (_) {}
		}
		try { term.dispose(); } catch (_) {}
		try { pane.remove(); } catch (_) {}
		delete app.terms[id];
	};
	app.terms[id] = { ...app.terms[id], term, fit, pane, wipe };
	connect();
}




async function uploadui(hide){
	const u = els.uploads;
	u.innerHTML = '';
	if(hide){
		_qs('body').classList.remove('upl');
		app.uploads = 0;
		switchToTab('files');
		return false;
	}
	app.uploads = 1;
	switchToTab('uploads');
	
	const up = {
		List: [],
		Toast: null,
		Total: 0,
		xhr: null,
		cancel: 0,
		lmsg: '',
		dir: app.curDir
	};

	const add = (items,input) => {
		for(const item of items){
			if(input){
				upThumb(item, item.webkitRelativePath || item.name);
			}else{
				const i = item.webkitGetAsEntry();
				if(!i){continue;}
				if(i.isFile){
					i.file((file) => {
						upThumb(file, i.name);
					});
				}else if(i.isDirectory){
					dirScan(i.createReader(), i.name);
				}
			}
		}
	};
	
	const dirScan = (rdr, path) => {
		rdr.readEntries((entries) => {
			for(const i of entries){
				const rel = path + '/' + i.name;
				if(i.isFile){
					i.file((file) => {
						upThumb(file, rel);
					});
				}else if(i.isDirectory){
					dirScan(i.createReader(), rel);
				}
			}
			if(entries.length > 0){
				dirScan(rdr, path);
			}
		});
	};
	
	const upThumb = (file, rel) => {
		rel = rel || file.webkitRelativePath || file.name;
		const pg = _ce('nav');
		const b = _ce('button',{'class':'uploadclose',title: "Close"},0,_ce('i',{'class':'ico-x'}));
		const li = _ce('li',0,0,[
			_ce('div',0,0,[b,_tn(rel)]),
			pg,
			_ce('label',0,{textContent: '0%'}),
			_tn(' of ' + filesize(file.size)),
		]);
		const obj = {f:file, rel, el:pg, cl:b, li };
		b.onclick = () => {
			up.List = up.List.filter(w => w !== obj);
			li.remove();
		};
		_id('uploadlist').appendChild(li);
		up.List.push(obj);
	};
	
	const upBar = (el,p)=>{
		el.style.width = p + '%';
		el.nextElementSibling.innerText = Math.floor(p) + '%';
	};
	
	const upNext = async (failed,curr) => {
		if(up.cancel || !up.List.length){
			up.List = failed;
			up.lmsg = '';
			if(up.cancel){
				toast('Upload aborted!',{timeout: 0,close: 1, theme:'red'});
			}else{
				toast('All uploads completed!',{timeout: 5,theme:'black'});
			}
			if(up.Toast){up.Toast.dismiss();}
			loadDir(up.dir);
			return;
		}
		
		if(curr===1){
			if(up.Toast){up.Toast.el.remove();}
			up.Toast = toast('',{timeout:0,theme:'black',close:1,click:()=>{up.cancel=1;up.xhr.abort();}});
		}
		const fobj = up.List[0];
		const file = fobj.f;
		const fd = new FormData();
		fd.append('file', file, file.name);
		
		up.Toast.update(curr + ' of '+up.Total+' Uploading: '+escapeHtml(fobj.rel)+up.lmsg);
		up.Toast.bar(curr, up.Total);
		
		const url = apiUrl("/api/file_shell_stream", {action: "upload", path: up.dir, mtime: file.lastModified, relpath: fobj.rel});
		
		const xhr = up.xhr = new XMLHttpRequest();
		xhr.open('POST', url, true);
		for (const [k, v] of Object.entries(await authHeaders() || {})) {
			xhr.setRequestHeader(k, v);
		}
		xhr.responseType = 'json';
		xhr.upload.onprogress = e => {
			if(e.lengthComputable){
				upBar(fobj.el,(e.loaded / e.total) * 100);
			}
		};
		xhr.onload = () => {
			let ok = false;
			
			if(xhr.status >= 200 && xhr.status < 300){
				const res = xhr.response;
				ok = !!(res && res.ok);
				
				if(ok){
					up.lmsg = '<br>' + escapeHtml(res.msg);
					fobj.cl.remove();
					fobj.li.style.opacity = '0.4';
				}else{
					toast((res && res.msg) || 'Upload failed', {theme:'red', timeout:30, close:1});
				}
			}else{
				toast('Error ' + xhr.status, {theme:'red', timeout:0, close:1});
			}
			
			if(!ok){failed.push(fobj);}
			
			upBar(fobj.el, ok ? 100 : 0);
			up.List.shift();
			upNext(failed, curr + 1);
		};
		
		xhr.onerror = async ()=>{
			toast('Error uploading '+file.name,{theme:'red',timeout:10,close:1});
			failed.push(fobj);
			up.List.shift();
			upBar(fobj.el,0);
			upNext(failed,curr+1);
		};
		xhr.send(fd);
	};
	
	const h = _ce('div',{id: 'uploadbox'},{
		ondrop: (e) => {
			e.preventDefault();
			h.classList.remove('drag');
			const files = e.dataTransfer.items;
			add(files);
		},
		ondragover: (e) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			h.classList.add('drag');
		}
		},[
		_ce('p',0,{textContent: 'Drag and drop folder/files here'}),
			_ce('p',0,{textContent: 'Path: '},_ce('button',{style: 'padding:5px'},{textContent: up.dir, onclick:(e)=>{
			folderPick(up.dir, "Upload path", "Select", (n)=>{
				up.dir = n;
				e.target.textContent = n;
				return true;
			});
		}} )),
		_ce('p',0,0,[
			_ce('p',0,0,[
				_ce('input',{multiple: '', type: 'file', id: 'uploadinput', style: 'display:none'},{onchange: (e) => {add(e.target.files,1);}}),
				_ce('label',{'class':'btn', 'for': 'uploadinput'},{textContent: 'Select Files'}),
				_ce('input',{multiple: '', webkitdirectory:'', type: 'file', id: 'uploadfolder', style: 'display:none'},{onchange: (e) => {add(e.target.files,1);}}),
				_ce('label',{'class':'btn', 'for': 'uploadfolder'},{textContent: 'Select Folder'}),
				_ce('span',{'class':'btn default'},{textContent: 'Upload Now', onclick: () => {
					if(up.List.length === 0){
						toast('No files selected',{theme:'red'});
						return;
					}
					up.cancel=0;
					up.Total = up.List.length;
					
					upNext([],1);
				}})
			]),
			_ce('ol',{id: 'uploadlist'})
		])
	]);
	
	u.appendChild(h);
}

async function MyConfig(save){
	const load = save ? 0 : 1
	save = save ? save : {}
	const d = await apiPost("config", save);
	if(d.opt){
		if(load){opt = d.opt;}
	}else{
		toast('Error Updating Config',{theme:'red'});
	}
}

async function init() {
	app.token = await getToken();
	if (!app.token) {
		toast("Could not find Home Assistant access token", {theme: 'red'});
		return;
	}
	await getEntities();
	await MyConfig();

	checkTheme(0);
	[
		_ce('div',{class:'group', id: 'toolbar_files'},0,[
			_ce('button',{title:'Refresh', class: 'ico-refresh'},{onclick: () => {loadDir(app.curDir);}}),
			_ce('button',{title:'Select', class: 'ico-tickbox'},{onclick:(e)=>{
				e.target.classList.toggle('primary',(app.multi = !app.multi));
				buildList();
			}}),
			_ce('button',{title:'Upload', class: 'ico-upload'},{onclick: ()=>{uploadui();}}),
			_ce('button',{title:'New File', class: 'ico-newfile'},{onclick: ()=>{createNewFile();}}),
			_ce('button',{title:'New Folder', class: 'ico-newdir'},{onclick: ()=>{createFolder();}}),
			_ce('button', { title: 'Terminal', class: 'ico-cmd' }, {onclick: () => terminal(app.curDir)}),
		]),
		_ce('div',{class:'group', id: 'toolbar_edit'},0,[
			_ce('button',{title: "Save", class:"ico-save"}, {onclick: ()=>{saveTextFile();}}),
			_ce('button',{id: "draftButton", title: "Restore Draft", class:"ico-restore"}, {onclick: (e)=>{
				const c = tabs.x[tabs.open].draft;
				if(c !== null){
					edit.cm.dispatch({ changes: { from: 0, to: edit.cm.state.doc.length, insert: c } });
					e.target.classList.add('hide');
					tabs.x[tabs.open].draft = null;
					toast("Restored");
				}
			}}),
			_ce('button',{title: "Undo", class:"ico-undo"}, {onclick: ()=>{CM.undo(edit.cm);}}),
			_ce('button',{title: "Redo", class:"ico-redo"}, {onclick: ()=>{CM.redo(edit.cm);}}),
			_ce('button',{title: "Find in file", class:"ico-search"}, {onclick: ()=>{
				app.find = !app.find;
				if(app.find){
					CM.openSearchPanel(edit.cm);
				}else{
					CM.closeSearchPanel(edit.cm);
				}
			}}),
			_ce('span',{id: "CMLang"},0,
				_ce("select", null, {onchange: (e) => {
						let s = _qs('#CMLang select').value;
						tabs.x[tabs.open].lang = s;
						extLang(s);
					}},
					['auto', 'text', ...Object.keys(edit.ext).sort()].map(v => _ce("option", { value: v }, { textContent: v }))
				)
			),
			_ce('button',{id: "valid", title: "Validate", class:"ico-check"}, {onclick: ()=>{validate();}}),
			_ce('button',{id: "wrapButton", title: "WordWrap", class:"ico-wrap"}, {onclick: ()=>{wordWrap();}}),
			_ce('button',{id: "bulbButton", title: "Auto Complete", class:"ico-flash"}, {onclick: ()=>{autoComp();}}),
			_ce('button',{id: "spaceButton", title: "Show Spaces", class:"ico-space"}, {onclick: ()=>{spaces();}}),
			_ce('button',{title: "Font -", class:"ico-fontsml"}, {onclick: ()=>{txtSize(-5);}}),
			_ce('button',{title: "Font +", class:"ico-fontbig"}, {onclick: ()=>{txtSize(5);}}),
		]),
	].forEach(b => {_qs('#main .toolbar').appendChild(b);});
	wordWrap(1);
	autoComp(1);
	spaces(1);
	_qs('#sidebar .toolbar').appendChild(
		_ce('div',{class:'group',style: "flex:1"},0,[
			_ce('button',{title:'Upload', class: 'ico-upload'},{onclick: ()=>{uploadui();}}),
			_ce('button', { title: 'Terminal', class: 'ico-cmd' }, {onclick: () => terminal(app.curDir)}),
			_ce('button',{title:'Color Mode', class: 'ico-'+theme, id: 'theme'},{onclick: colorMode}),
			_ce('span',{style: "flex:1"}),
			_ce('button',{title:'Close', class: 'ico-x'},{onclick: _=>{sidebar(0);}}),
		])
	
	);

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {checkTheme(1);});
	
	_on(document,"click", () => {hideMenu();});
	
	_on(document,"keydown", (e) => {
		if (e.key === "Escape") {hideMenu();}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			saveTextFile().catch(showError);
		}
	});
	
	_on(els.files, "contextmenu", (e) => {
		let t = e.target;
		while (t && t !== els.files) {
			if (t.tagName === 'TR'){return;}
			t = t.parentNode;
		}
		e.preventDefault();
		dirContext(e.clientX, e.clientY);
	});
	
	favList(0);
	buildTabs();
	loadDir("/");
}

init();

	
})();
