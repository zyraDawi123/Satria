import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { GOOGLE_CLIENT_ID, GOOGLE_SHEET_ID, GOOGLE_SHEET_RANGE, GOOGLE_SCOPES } from './config.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const loginScreen = $('login-screen');
const dashboard = $('dashboard');
const loginMessage = $('login-message');
const loading = $('loading');
const detailPanel = $('detail-panel');

let tokenClient;
let accessToken = null;
let people = [];
let camera, scene, renderer, controls, animationId;
let cards = [];
let activeLayout = 'table';
let raycaster, pointer;
let currentUserEmail = '';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  const headers = rows.shift().map(h => h.trim());
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()])));
}

function normalizePerson(row, index) {
  const find = (...names) => {
    const key = Object.keys(row).find(k => names.includes(k.trim().toLowerCase()));
    return key ? row[key] : '';
  };
  const netWorthText = String(find('net worth', 'networth', 'worth')).replace(/[$,\s]/g, '');
  const netWorth = Number(netWorthText) || 0;
  return {
    id: index + 1,
    name: String(find('name', 'full name') || `Record ${index + 1}`),
    photo: String(find('photo', 'image', 'photo url', 'profile photo') || ''),
    age: String(find('age') || ''),
    country: String(find('country') || ''),
    interest: String(find('interest', 'interests') || ''),
    netWorth,
    netWorthLabel: String(find('net worth', 'networth', 'worth') || '$0')
  };
}

function worthClass(value) {
  if (value < 100000) return 'low';
  if (value <= 200000) return 'mid';
  return 'high';
}

function showLogin(message = '') {
  loginScreen.classList.remove('hidden');
  dashboard.classList.add('hidden');
  loginMessage.textContent = message;
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  $('user-email').textContent = currentUserEmail;
}

function initializeGoogleIdentity() {
  if (!GOOGLE_CLIENT_ID) {
    $('google-signin').disabled = true;
    $('google-signin').title = 'Set VITE_GOOGLE_CLIENT_ID in .env first';
    loginMessage.textContent = 'Google OAuth is not configured yet. Use CSV preview, or complete the setup in README.md.';
    return;
  }
  const waitForGoogle = () => {
    if (!window.google?.accounts?.oauth2) return setTimeout(waitForGoogle, 100);
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: async (response) => {
        if (response.error) {
          showLogin(`Google sign-in failed: ${response.error}`);
          return;
        }
        accessToken = response.access_token;
        try {
          await loadGoogleSheet();
          await loadGoogleUser();
          showDashboard();
          renderPeople();
        } catch (error) {
          showLogin(error.message || 'Unable to load Google Sheets data.');
        }
      }
    });
    $('google-signin').disabled = false;
  };
  waitForGoogle();
}

async function loadGoogleUser() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.ok) {
    const user = await res.json();
    currentUserEmail = user.email || '';
  }
}

async function loadGoogleSheet() {
  if (!GOOGLE_SHEET_ID) throw new Error('Set VITE_GOOGLE_SHEET_ID in .env to your Google Sheet ID.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(GOOGLE_SHEET_ID)}/values/${encodeURIComponent(GOOGLE_SHEET_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Sheets request failed. Check Sheet ID, sharing and API settings.');
  const values = data.values || [];
  if (values.length < 2) throw new Error('The configured sheet range has no data rows.');
  const headers = values[0].map(v => String(v).trim());
  const rows = values.slice(1).map(valuesRow => Object.fromEntries(headers.map((h, i) => [h, valuesRow[i] ?? ''])));
  people = rows.map(normalizePerson);
}

async function loadSampleCsv() {
  const res = await fetch('/ZyraGam.csv');
  if (!res.ok) throw new Error('The sample CSV could not be loaded.');
  people = parseCsv(await res.text()).map(normalizePerson);
  currentUserEmail = 'CSV preview mode';
  showDashboard();
  renderPeople();
}

function cardElement(person) {
  const el = document.createElement('article');
  el.className = `person-card ${worthClass(person.netWorth)}`;
  const photo = document.createElement('img');
  photo.className = 'person-photo';
  photo.src = person.photo;
  photo.alt = person.name;
  photo.loading = 'lazy';
  const fallback = document.createElement('div');
  fallback.className = 'photo-fallback';
  fallback.hidden = true;
  fallback.textContent = person.name.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  photo.onerror = () => { photo.style.display = 'none'; fallback.hidden = false; };
  const name = document.createElement('div');
  name.className = 'person-name';
  name.textContent = person.name;
  const worth = document.createElement('div');
  worth.className = 'person-worth';
  worth.textContent = person.netWorthLabel;
  const meta = document.createElement('div');
  meta.className = 'person-meta';
  meta.textContent = [person.country, person.interest].filter(Boolean).join(' · ');
  el.append(photo, fallback, name, worth, meta);
  el.addEventListener('click', () => showDetails(person));
  return el;
}

function showDetails(person) {
  detailPanel.innerHTML = '';
  detailPanel.classList.remove('hidden');
  const close = document.createElement('button');
  close.className = 'detail-close';
  close.textContent = '×';
  close.onclick = () => detailPanel.classList.add('hidden');
  const heading = document.createElement('h2');
  heading.textContent = person.name;
  const rows = [
    ['Net worth', person.netWorthLabel], ['Age', person.age],
    ['Country', person.country], ['Interest', person.interest]
  ];
  detailPanel.append(close, heading);
  rows.forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(value || '—'));
    detailPanel.append(p);
  });
}

function targetTable(i) {
  const cols = 20, x = i % cols, y = Math.floor(i / cols);
  const o = new THREE.Object3D();
  o.position.set((x - (cols - 1) / 2) * 145, (4.5 - y) * 178, 0);
  return o;
}

function targetSphere(i, count) {
  const phi = Math.acos(-1 + (2 * i) / count);
  const theta = Math.sqrt(count * Math.PI) * phi;
  const o = new THREE.Object3D();
  o.position.setFromSphericalCoords(1120, phi, theta);
  o.lookAt(o.position.clone().multiplyScalar(2));
  return o;
}

function targetDoubleHelix(i, count) {
  const strand = i % 2;
  const step = Math.floor(i / 2);
  const perStrand = Math.ceil(count / 2);
  const angle = step * 0.235 + strand * Math.PI;
  const radius = 780;
  const y = (perStrand - 1) * 13 - step * 26;
  const o = new THREE.Object3D();
  o.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  o.lookAt(o.position.clone().add(tangent));
  return o;
}

function targetGrid(i) {
  // 10 columns × 4 rows × 5 depth layers = 200 cards (5 × 4 × 10).
  const x = i % 10;
  const y = Math.floor(i / 10) % 4;
  const z = Math.floor(i / 40);
  const o = new THREE.Object3D();
  o.position.set((x - 4.5) * 155, (1.5 - y) * 195, (z - 2) * 235);
  return o;
}

function renderPeople() {
  $('record-count').textContent = `${people.length} records`;
  if (!renderer) initScene();
  cards.forEach(c => scene.remove(c));
  cards = [];
  people.forEach((person, i) => {
    const object = new CSS3DObject(cardElement(person));
    object.position.set((Math.random() - .5) * 3500, (Math.random() - .5) * 2500, (Math.random() - .5) * 3000);
    scene.add(object);
    cards.push(object);
  });
  transform(activeLayout, 0);
}

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, $('stage').clientWidth / $('stage').clientHeight, 1, 12000);
  camera.position.set(0, 0, 3600);
  renderer = new CSS3DRenderer();
  renderer.setSize($('stage').clientWidth, $('stage').clientHeight);
  $('stage').appendChild(renderer.domElement);
  controls = new TrackballControls(camera, renderer.domElement);
  controls.minDistance = 600;
  controls.maxDistance = 9000;
  controls.rotateSpeed = 1.2;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  animate();
}

function transform(layout, duration = 1300) {
  activeLayout = layout;
  document.querySelectorAll('.view-menu button').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
  const start = performance.now();
  const from = cards.map(c => ({ p: c.position.clone(), q: c.quaternion.clone() }));
  const targets = cards.map((card, i) => {
    if (layout === 'sphere') return targetSphere(i, cards.length);
    if (layout === 'helix') return targetDoubleHelix(i, cards.length);
    if (layout === 'grid') return targetGrid(i);
    return targetTable(i);
  });
  function step(now) {
    const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    cards.forEach((card, i) => {
      card.position.lerpVectors(from[i].p, targets[i].position, eased);
      card.quaternion.copy(from[i].q).slerp(targets[i].quaternion, eased);
    });
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  controls?.update();
  renderer?.render(scene, camera);
}

function onResize() {
  if (!renderer || !$('stage').clientWidth) return;
  camera.aspect = $('stage').clientWidth / $('stage').clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize($('stage').clientWidth, $('stage').clientHeight);
  controls?.handleResize();
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cards, true);
  if (hits.length) {
    const element = hits[0].object.element;
    if (element) element.click();
  }
}

$('google-signin').addEventListener('click', () => {
  if (!tokenClient) {
    loginMessage.textContent = 'Google sign-in is not configured. Complete the Google Cloud setup in README.md.';
    return;
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
});
$('sample-mode').addEventListener('click', async () => {
  try { await loadSampleCsv(); } catch (e) { showLogin(e.message); }
});
$('refresh-data').addEventListener('click', async () => {
  if (!accessToken) return;
  loading.classList.remove('hidden');
  try { await loadGoogleSheet(); renderPeople(); }
  catch (e) { alert(e.message); }
  finally { loading.classList.add('hidden'); }
});
$('signout').addEventListener('click', () => {
  if (accessToken && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(accessToken);
  accessToken = null; currentUserEmail = ''; people = [];
  cards.forEach(c => scene?.remove(c)); cards = [];
  showLogin();
});
document.querySelectorAll('.view-menu button').forEach(button => {
  button.addEventListener('click', () => transform(button.dataset.layout));
});

initializeGoogleIdentity();
