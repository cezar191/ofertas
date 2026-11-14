/*
 * Landing de ofertas. Lee data/catalogo.json (lo genera FrasisStore cada pocos minutos, ver
 * Services/LandingExportService.cs) y arma todo en el navegador. No hay servidor: es un sitio
 * estático, así que si la tienda se queda sin internet la página sigue mostrando la última foto.
 *
 * El precio YA VIENE resuelto en el JSON (c_product.CurrentPrice manda, ver CLAUDE.md). Lo único
 * que se decide aquí es ocultar una oferta cuyo offer_ends_at ya pasó, para no anunciar una
 * promoción vencida entre una publicación y la siguiente.
 */
(function () {
  "use strict";

  var PAGE = 24;
  var BAG_KEY = "landing-bag-v1";
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    data: null,
    products: [],
    line: "",
    type: "",
    q: "",
    size: "",
    onlyOffers: false,
    sort: "relevance",
    shown: 0,
    filtered: [],
    bag: loadBag(),
    current: null,
    currentSize: null
  };

  // ---------------------------------------------------------------- utilidades
  var mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  function money(n) {
    // Sin centavos si son cerrados, con centavos si no ($349 vs $349.50).
    return n % 1 === 0 ? mxn.format(n) : "$" + Number(n).toFixed(2);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function pct(p) {
    return p.regular_price && p.regular_price > p.price ? Math.round((1 - p.price / p.regular_price) * 100) : 0;
  }
  function get(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function toast(msg, actionLabel, action) {
    var t = $("toast");
    // Palomita solo en los avisos de éxito (los que traen acción); "Elige tu talla" no la lleva.
    t.innerHTML = (actionLabel ? '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg>' : "") + "<span></span>";
    t.querySelector("span").textContent = msg;
    if (actionLabel) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = actionLabel;
      b.onclick = function () { t.hidden = true; action(); };
      t.appendChild(b);
    }
    // Reiniciar la animación de entrada aunque el aviso anterior siga visible.
    t.hidden = true; void t.offsetWidth; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, actionLabel ? 3500 : 2200);
  }
  function waLink(text) {
    var n = state.data && state.data.store.whatsapp;
    if (!n) return null;
    return "https://wa.me/52" + n + "?text=" + encodeURIComponent(text);
  }
  function pageUrl(code) {
    return location.origin + location.pathname + (code ? "#p=" + encodeURIComponent(code) : "");
  }

  // ---------------------------------------------------------------- carga
  // ?v= evita que el navegador muestre un JSON viejo de su caché.
  fetch("data/catalogo.json?v=" + Math.floor(Date.now() / 60000), { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () {
      $("loading").hidden = true;
      $("resultInfo").textContent = "No pudimos cargar el catálogo. Escríbenos por WhatsApp y con gusto te atendemos.";
    });

  function init(data) {
    state.data = data;
    var now = Date.now();

    // Una oferta vencida desde la última publicación se muestra a precio normal.
    state.products = (data.products || []).map(function (p) {
      if (p.offer && p.offer_ends_at && Date.parse(p.offer_ends_at) <= now && p.regular_price) {
        p = Object.assign({}, p, { price: p.regular_price, regular_price: null, offer: null, offer_ends_at: null });
      }
      p._search = norm(p.name + " " + p.code + " " + p.type + " " + (p.color || ""));
      p._pct = pct(p);
      return p;
    });

    bindText();
    setupWhatsApp();
    setupSocials();
    setupCountdown();
    setupStats();
    buildLines();
    buildTypes();
    buildSizes();
    readHash();
    apply();
    renderBag();
    $("loading").hidden = true;

    var gen = new Date(data.generated_at);
    $("updated").textContent = "Existencias actualizadas: " +
      gen.toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + ".";
    document.title = (data.campaign.title || "Ofertas") + " · " + (data.store.name || "");
  }

  function bindText() {
    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var v = get(state.data, el.getAttribute("data-bind"));
      if (v == null || v === "") {
        if (el.hasAttribute("data-hide-empty")) el.hidden = true;
        return;
      }
      el.textContent = v;
    });
  }

  function setupWhatsApp() {
    var link = waLink("¡Hola! Vi sus ofertas de " + (state.data.campaign.title || "temporada") + " y quiero información.");
    document.querySelectorAll("[data-wa-general]").forEach(function (a) {
      if (link) a.href = link; else a.hidden = true;
    });
    if (!link) document.querySelectorAll(".wa-only").forEach(function (a) { a.hidden = true; });
    if (state.data.store.maps_url) { $("mapsLink").href = state.data.store.maps_url; $("mapsLink").hidden = false; }
  }

  function setupSocials() {
    var s = state.data.store, html = "";
    [["facebook_url", "i-fb", "Facebook"], ["instagram_url", "i-ig", "Instagram"], ["tiktok_url", "i-tt", "TikTok"]]
      .forEach(function (x) {
        if (s[x[0]]) html += '<a href="' + esc(s[x[0]]) + '" target="_blank" rel="noopener" aria-label="' + x[2] +
          '"><svg viewBox="0 0 24 24"><use href="#' + x[1] + '"/></svg></a>';
      });
    $("socials").innerHTML = html;
  }

  function setupCountdown() {
    var end = state.data.campaign.ends_at && Date.parse(state.data.campaign.ends_at);
    if (!end) return;
    var box = $("countdown");
    function tick() {
      var d = end - Date.now();
      if (d <= 0) { box.hidden = true; clearInterval(timer); return; }
      box.hidden = false;
      var s = Math.floor(d / 1000);
      $("cdD").textContent = Math.floor(s / 86400);
      $("cdH").textContent = String(Math.floor(s % 86400 / 3600)).padStart(2, "0");
      $("cdM").textContent = String(Math.floor(s % 3600 / 60)).padStart(2, "0");
      $("cdS").textContent = String(s % 60).padStart(2, "0");
    }
    var timer = setInterval(tick, 1000);
    tick();
  }

  function setupStats() {
    var offers = state.products.filter(function (p) { return p.offer; });
    var maxPct = offers.reduce(function (m, p) { return Math.max(m, p._pct); }, 0);
    var html = "<span><b>" + state.products.length + "</b> prendas disponibles</span>";
    if (offers.length) html += "<span><b>" + offers.length + "</b> en oferta</span>";
    if (maxPct >= 5) html += "<span>hasta <b>" + maxPct + "%</b> de descuento</span>";
    $("heroStats").innerHTML = html;
    if (!offers.length) $("ctaOffers").textContent = "Ver prendas";
  }

  // ---------------------------------------------------------------- filtros
  function countBy(list, key) {
    var m = {};
    list.forEach(function (p) { var k = p[key] || ""; m[k] = (m[k] || 0) + 1; });
    return m;
  }

  function buildLines() {
    var lines = countBy(state.products, "line");
    var names = Object.keys(lines);
    if (names.length < 2) return;
    // Dama primero: es el público principal.
    names.sort(function (a, b) { return (a === "Dama" ? -1 : b === "Dama" ? 1 : lines[b] - lines[a]); });
    state.line = "";
    var html = '<button class="line-tab" role="tab" aria-selected="true" data-line="">Todo</button>';
    names.forEach(function (n) {
      html += '<button class="line-tab" role="tab" aria-selected="false" data-line="' + esc(n) + '">' + esc(n) + "</button>";
    });
    $("lines").innerHTML = html;
    $("lines").addEventListener("click", function (e) {
      var b = e.target.closest(".line-tab"); if (!b) return;
      state.line = b.getAttribute("data-line");
      state.type = "";
      $("lines").querySelectorAll(".line-tab").forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      buildTypes();
      apply();
    });
  }

  // Chips de tipo con su existencia: "la gente vea las existencias por tipo".
  function buildTypes() {
    var base = state.products.filter(function (p) { return !state.line || p.line === state.line; });
    var counts = {}, hot = {};
    base.forEach(function (p) {
      counts[p.type] = (counts[p.type] || 0) + 1;
      if (p.offer) hot[p.type] = true;
    });
    var types = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var html = '<button class="chip' + (state.type ? "" : " on") + '" data-type="">Todo <small>' + base.length + "</small></button>";
    types.forEach(function (t) {
      html += '<button class="chip' + (state.type === t ? " on" : "") + (hot[t] ? " hot" : "") + '" data-type="' + esc(t) + '">' +
        esc(t) + " <small>" + counts[t] + "</small></button>";
    });
    $("types").innerHTML = html;
  }
  $("types").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    state.type = b.getAttribute("data-type");
    $("types").querySelectorAll(".chip").forEach(function (x) { x.classList.toggle("on", x === b); });
    apply();
  });

  function buildSizes() {
    var set = {};
    state.products.forEach(function (p) { p.sizes.forEach(function (s) { set[s.code] = true; }); });
    var order = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "1XL", "2XL", "3XL", "4XL", "5XL"];
    var codes = Object.keys(set).sort(function (a, b) {
      var ia = order.indexOf(a.toUpperCase()), ib = order.indexOf(b.toUpperCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1; if (ib >= 0) return 1;
      return a.localeCompare(b, "es", { numeric: true });
    });
    $("size").innerHTML = '<option value="">Todas las tallas</option>' +
      codes.map(function (c) { return '<option value="' + esc(c) + '">Talla ' + esc(c) + "</option>"; }).join("");
  }

  var qTimer;
  $("q").addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = norm($("q").value.trim()); apply(); }, 180);
  });
  $("size").addEventListener("change", function () { state.size = this.value; apply(); });
  $("sort").addEventListener("change", function () { state.sort = this.value; apply(); });
  $("onlyOffers").addEventListener("click", function () {
    state.onlyOffers = !state.onlyOffers;
    this.setAttribute("aria-pressed", state.onlyOffers);
    apply();
  });
  $("ctaOffers").addEventListener("click", function () {
    if (state.products.some(function (p) { return p.offer; }) && !state.onlyOffers) $("onlyOffers").click();
  });
  $("clearFilters").addEventListener("click", function () {
    state.type = ""; state.q = ""; state.size = ""; state.onlyOffers = false;
    $("q").value = ""; $("size").value = ""; $("onlyOffers").setAttribute("aria-pressed", "false");
    buildTypes(); apply();
  });

  function apply() {
    var words = state.q ? state.q.split(/\s+/) : [];
    var list = state.products.filter(function (p) {
      if (state.line && p.line !== state.line) return false;
      if (state.type && p.type !== state.type) return false;
      if (state.onlyOffers && !p.offer) return false;
      if (state.size && !p.sizes.some(function (s) { return s.code === state.size; })) return false;
      for (var i = 0; i < words.length; i++) if (p._search.indexOf(words[i]) < 0) return false;
      return true;
    });
    var sorters = {
      discount: function (a, b) { return b._pct - a._pct; },
      "price-asc": function (a, b) { return a.price - b.price; },
      "price-desc": function (a, b) { return b.price - a.price; },
      "new": function (a, b) { return String(b.arrived_at).localeCompare(String(a.arrived_at)); }
    };
    if (sorters[state.sort]) list = list.slice().sort(sorters[state.sort]);
    state.filtered = list;
    state.shown = 0;
    $("grid").innerHTML = "";
    $("empty").hidden = list.length > 0;
    $("resultInfo").textContent = list.length === 1 ? "1 prenda" : list.length + " prendas";
    more();
  }

  // ---------------------------------------------------------------- tarjetas
  function imgTag(p, cls) {
    if (!p.image) return '<div class="ph ' + (cls || "") + '">' + esc((p.type || "?").charAt(0)) + "</div>";
    return '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" data-ph="' + esc((p.type || "?").charAt(0)) +
      '" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
  }
  // Foto rota (el CDN la retiró, p. ej.): se cambia por la inicial del tipo en vez del ícono roto.
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (img.tagName !== "IMG" || !img.hasAttribute("data-ph")) return;
    var ph = document.createElement("div");
    ph.className = "ph";
    ph.textContent = img.getAttribute("data-ph");
    img.replaceWith(ph);
  }, true);
  function priceHtml(p) {
    return '<div class="price' + (p.offer ? " offer" : "") + '"><span class="now">' + money(p.price) + "</span>" +
      (p.regular_price ? "<s>" + money(p.regular_price) + "</s>" : "") + "</div>";
  }
  function badgesHtml(p) {
    var b = "";
    if (p._pct >= 5) b += '<span class="badge badge-off">-' + p._pct + "%</span>";
    if (p.offer === "clearance") b += '<span class="badge badge-clear">Liquidación</span>';
    else if (p.offer === "discount" && p._pct < 5) b += '<span class="badge badge-off">Oferta</span>';
    if (p.is_new) b += '<span class="badge badge-new">Nuevo</span>';
    if (p.stock === 1) b += '<span class="badge badge-last">Última pieza</span>';
    return b;
  }
  function card(p) {
    var sizes = p.sizes.slice(0, 6).map(function (s) { return "<span>" + esc(s.code) + "</span>"; }).join("");
    if (p.sizes.length > 6) sizes += "<span>+" + (p.sizes.length - 6) + "</span>";
    return '<button type="button" class="card" data-code="' + esc(p.code) + '">' +
      '<div class="card-media">' + imgTag(p) + '<div class="badges">' + badgesHtml(p) + "</div></div>" +
      '<div class="card-body">' +
      '<p class="card-name" title="' + esc(p.name) + '">' + esc(p.name) + "</p>" +
      '<span class="card-code">Código ' + esc(p.code) + "</span>" +
      priceHtml(p) +
      '<div class="sizes-mini">' + sizes + "</div>" +
      "</div></button>";
  }
  function more() {
    var next = state.filtered.slice(state.shown, state.shown + PAGE);
    if (!next.length) return;
    $("grid").insertAdjacentHTML("beforeend", next.map(card).join(""));
    state.shown += next.length;
  }
  // Scroll infinito: 24 a la vez para que el celular no descargue cientos de fotos de golpe.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e) { if (e[0].isIntersecting && state.data) more(); }, { rootMargin: "800px" })
      .observe($("sentinel"));
  }
  $("grid").addEventListener("click", function (e) {
    var c = e.target.closest(".card"); if (!c) return;
    openProduct(c.getAttribute("data-code"));
  });

  // ---------------------------------------------------------------- detalle
  function findByCode(code) {
    for (var i = 0; i < state.products.length; i++) if (state.products[i].code === code) return state.products[i];
    return null;
  }

  function openProduct(code, fromHash) {
    var p = findByCode(code);
    if (!p) { if (fromHash) toast("Esa prenda ya se agotó. Mira lo que sigue disponible."); return; }
    state.current = p;
    state.currentSize = p.sizes.length === 1 ? p.sizes[0].code : null;

    var img = $("pImg");
    img.src = p.image_full || p.image || "";
    img.alt = p.name;
    img.hidden = !(p.image_full || p.image);
    $("pBadges").innerHTML = badgesHtml(p);
    $("pTitle").textContent = p.name;
    $("pMeta").textContent = ["Código " + p.code, p.type, p.color].filter(Boolean).join(" · ");
    $("pPrice").innerHTML = priceHtml(p);
    if (p.offer_ends_at) {
      $("pEnds").hidden = false;
      $("pEnds").textContent = "Oferta válida hasta el " +
        new Date(p.offer_ends_at).toLocaleString("es-MX", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
    } else $("pEnds").hidden = true;
    $("pDesc").hidden = !p.description;
    $("pDesc").textContent = p.description || "";
    renderSizes();

    var sheet = $("productSheet");
    if (!sheet.open) sheet.showModal();
    if (!fromHash) history.replaceState(null, "", "#p=" + encodeURIComponent(p.code));
  }

  function renderSizes() {
    var p = state.current;
    $("pSizes").innerHTML = p.sizes.map(function (s) {
      return '<button type="button" class="size-opt" role="radio" aria-checked="' + (state.currentSize === s.code) +
        '" data-size="' + esc(s.code) + '" title="' + esc(s.name) + '">' + esc(s.code) +
        (s.qty === 1 ? "<small>última</small>" : "") + "</button>";
    }).join("");
    $("pSizeHint").textContent = state.currentSize ? "· " + state.currentSize : "· elige una";
    updateProductWa();
  }
  $("pSizes").addEventListener("click", function (e) {
    var b = e.target.closest(".size-opt"); if (!b) return;
    state.currentSize = b.getAttribute("data-size");
    renderSizes();
  });

  function itemLine(p, size) {
    return "• " + p.name.slice(0, 70) + " — Código " + p.code + (size ? ", talla " + size : "") + " — " + money(p.price);
  }
  function updateProductWa() {
    var p = state.current;
    var link = waLink("¡Hola! Me interesa esta prenda:\n" + itemLine(p, state.currentSize) +
      (state.currentSize ? "" : "\n¿Qué tallas tienen?") + "\n" + pageUrl(p.code));
    var a = $("pWa");
    if (link) { a.href = link; a.hidden = false; } else a.hidden = true;
  }

  $("pAdd").addEventListener("click", function () {
    var p = state.current;
    if (!state.currentSize && p.sizes.length > 1) {
      toast("Elige tu talla");
      $("pSizes").animate && $("pSizes").animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], 200);
      return;
    }
    var size = state.currentSize || (p.sizes[0] && p.sizes[0].code) || "";
    var exists = state.bag.some(function (i) { return i.code === p.code && i.size === size; });
    if (exists) { toast("Ya está en tu bolsa"); return; }
    state.bag.push({ code: p.code, size: size });
    saveBag(); renderBag();

    // Confirmación en tres tiempos, para que no pase desapercibida en el celular:
    // 1) el botón se pone verde con palomita, 2) se cierra la ficha y la bolsa de arriba "brinca",
    // 3) aparece un aviso con acceso directo a la bolsa.
    var btn = $("pAdd");
    btn.classList.add("added");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg> ¡Agregada!';
    setTimeout(function () {
      $("productSheet").close();
      btn.classList.remove("added");
      btn.textContent = "Agregar a mi bolsa";
      var bag = $("openBag");
      bag.classList.remove("bump"); void bag.offsetWidth; bag.classList.add("bump");
      toast("Agregada a tu bolsa · " + state.bag.length + (state.bag.length === 1 ? " prenda" : " prendas"), "Ver bolsa", function () {
        renderBag(); $("bagDrawer").showModal();
      });
    }, 650);
  });

  $("pShare").addEventListener("click", function () {
    var p = state.current, url = pageUrl(p.code);
    var text = p.name + " — " + money(p.price) + (p.regular_price ? " (antes " + money(p.regular_price) + ")" : "");
    if (navigator.share) {
      navigator.share({ title: state.data.store.name || "", text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + "\n" + url).then(function () { toast("Enlace copiado"); });
    }
  });

  // Cerrar diálogos: botón ×, clic en el fondo, o Esc (nativo).
  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  });
  $("productSheet").addEventListener("close", function () {
    if (location.hash.indexOf("#p=") === 0) history.replaceState(null, "", location.pathname + location.search);
  });

  // Enlace directo a una prenda (#p=CODIGO): lo que se comparte en WhatsApp/Facebook abre la ficha.
  function readHash() {
    var m = location.hash.match(/^#p=(.+)$/);
    if (m) openProduct(decodeURIComponent(m[1]), true);
  }
  window.addEventListener("hashchange", function () { if (state.data) readHash(); });

  // ---------------------------------------------------------------- bolsa
  function loadBag() {
    try { return JSON.parse(localStorage.getItem(BAG_KEY)) || []; } catch (e) { return []; }
  }
  function saveBag() {
    try { localStorage.setItem(BAG_KEY, JSON.stringify(state.bag)); } catch (e) { /* modo privado */ }
  }

  function renderBag() {
    if (!state.data) return;
    // Lo que se agotó desde la última visita sale de la bolsa solo.
    var items = state.bag.map(function (i) { return { i: i, p: findByCode(i.code) }; }).filter(function (x) { return x.p; });
    if (items.length !== state.bag.length) { state.bag = items.map(function (x) { return x.i; }); saveBag(); }

    var n = items.length;
    $("bagCount").hidden = n === 0;
    $("bagCount").textContent = n;
    $("bagClear").hidden = n === 0;

    if (!n) {
      $("bagItems").innerHTML = '<p class="bag-empty">Tu bolsa está vacía.<br>Toca una prenda para agregarla.</p>';
    } else {
      $("bagItems").innerHTML = items.map(function (x, idx) {
        return '<div class="bag-item">' + imgTag(x.p) +
          '<div><p class="bi-name" title="' + esc(x.p.name) + '">' + esc(x.p.name) + "</p>" +
          '<p class="bi-meta">Código ' + esc(x.p.code) + (x.i.size ? " · Talla " + esc(x.i.size) : "") + "</p>" +
          '<p class="bi-price">' + money(x.p.price) + "</p></div>" +
          '<button type="button" class="bag-remove" data-idx="' + idx + '" aria-label="Quitar ' + esc(x.p.name) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"/></svg><span>Quitar</span></button></div>';
      }).join("");
    }

    var total = items.reduce(function (s, x) { return s + x.p.price; }, 0);
    $("bagTotal").textContent = money(total);

    updateBagWa(items, total);
  }

  function updateBagWa(items, total) {
    var a = $("bagSend");
    if (!items.length) { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); a.style.opacity = ".5"; return; }
    // Solo tienda física: no hay opción de entrega a domicilio.
    var msg = "¡Hola! Quiero apartar estas prendas:\n" +
      items.map(function (x) { return itemLine(x.p, x.i.size); }).join("\n") +
      "\n\nTotal: " + money(total) +
      "\nLas recojo en tienda.";
    var link = waLink(msg);
    if (link) { a.href = link; a.removeAttribute("aria-disabled"); a.style.opacity = ""; }
  }

  $("bagItems").addEventListener("click", function (e) {
    var b = e.target.closest(".bag-remove"); if (!b) return;
    var row = b.closest(".bag-item");
    var idx = +b.getAttribute("data-idx");
    // La fila se desliza hacia afuera antes de desaparecer: que se VEA que sí se quitó.
    row.classList.add("leaving");
    setTimeout(function () {
      state.bag.splice(idx, 1);
      saveBag(); renderBag();
    }, 220);
  });
  $("bagClear").addEventListener("click", function () {
    if (!confirm("¿Quitar todas las prendas de tu bolsa?")) return;
    state.bag = [];
    saveBag(); renderBag();
    toast("Bolsa vacía");
  });
  $("openBag").addEventListener("click", function () { renderBag(); $("bagDrawer").showModal(); });
})();
