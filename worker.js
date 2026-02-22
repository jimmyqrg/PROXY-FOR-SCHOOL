// ============================================================
// ULTRA DEFENSIVE PROXY - MAX FIX VERSION
// Handles ALL edge cases including WebSockets, Blobs, dynamic imports
// ============================================================

// --------------------
// Safe URL utilities
// --------------------
function safeString(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try { return String(val); } catch { return ''; }
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  url = url.trim();
  if (url.length === 0) return false;
  if (url.length > 8192) return false; // Prevent DoS with huge URLs
  return true;
}

function isSpecialUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase().trim();
  if (lower === '#' || lower === '') return true;
  // Detect any non-HTTP(S) scheme (RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ))
  // Only http: and https: should be proxied; everything else is special.
  const colonIdx = lower.indexOf(':');
  if (colonIdx > 0 && colonIdx < 20) {
    const scheme = lower.substring(0, colonIdx);
    if (/^[a-z][a-z0-9+\-.]*$/.test(scheme) && scheme !== 'http' && scheme !== 'https') {
      return true;
    }
  }
  return false;
}

function isAlreadyProxied(url) {
  if (!url) return false;
  return url.includes('/?url=') || url.includes('/?embedded=') || 
         url.includes('proxy.ikunbeautiful.workers.dev') ||
         url.includes('%2F%3Furl%3D') || url.includes('%2F%3Fembedded%3D') ||
         url.includes('proxy.ikunbeautiful.workers.dev');
}

// --------------------
// URL Rewriting - ULTRA SAFE
// --------------------
function rewriteUrl(original, base, isEmbedded = false) {
    try {
    original = safeString(original).trim();
    
    if (!isValidUrl(original)) return original;
    if (isSpecialUrl(original)) return original;
    if (isAlreadyProxied(original)) return original;
    
    // Handle protocol-relative URLs
    if (original.startsWith('//')) {
      original = 'https:' + original;
    }
    
    // Decode if double-encoded
    let decoded = original;
    try {
      if (original.includes('%25')) {
        decoded = decodeURIComponent(original);
      }
    } catch {}
    
    // Resolve the URL against base
    let abs;
    try {
      abs = new URL(decoded, base).toString();
    } catch {
      // If URL parsing fails, try with the original
      try {
        abs = new URL(original, base).toString();
      } catch {
        return original; // Give up, return as-is
      }
    }

    // Don't proxy our own worker or already-proxied URLs
    if (abs.includes("proxy.ikunbeautiful.workers.dev")) return original;
    if (isAlreadyProxied(abs)) return original;
  
    // Build proxied URL
    const prefix = isEmbedded ? "/?embedded=1&url=" : "/?url=";
    return prefix + encodeURIComponent(abs);
    } catch {
      return original;
    }
  }
  
  // --------------------
// Rewrite srcset attribute (complex format)
  // --------------------
function rewriteSrcset(srcset, base, isEmbedded) {
  if (!srcset || typeof srcset !== 'string') return srcset;
  try {
    // Split on comma followed by whitespace to avoid breaking URLs with commas
    // (e.g. CDN image transformation URLs: /cdn-cgi/image/quality=78,width=314,f=auto/img.png)
    return srcset.split(/,\s+/).map(s => {
      const parts = s.trim().split(/\s+/);
      if (parts[0] && !isSpecialUrl(parts[0])) {
        parts[0] = rewriteUrl(parts[0], base, isEmbedded);
      }
      return parts.join(' ');
    }).join(', ');
  } catch {
    return srcset;
  }
}

// --------------------
// HTML Element Rewriters
// --------------------
class SafeRewriter {
  constructor(base, isEmbedded) { 
    this.base = base; 
    this.isEmbedded = isEmbedded; 
  }
  
  safeRewrite(el, attr) {
    try {
      const val = el.getAttribute(attr);
      if (val && !isSpecialUrl(val) && !isAlreadyProxied(val)) {
        el.setAttribute(attr, rewriteUrl(val, this.base, this.isEmbedded));
      }
    } catch {}
  }
  
  safeRewriteSrcset(el) {
    try {
      const srcset = el.getAttribute("srcset");
      if (srcset) {
        el.setAttribute("srcset", rewriteSrcset(srcset, this.base, this.isEmbedded));
      }
    } catch {}
    }
  }
  
class AnchorRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "href");
    
    // Handle ping attribute (tracking URLs)
    try {
      const ping = el.getAttribute("ping");
      if (ping) {
        const proxiedPing = ping.split(/\s+/).map(url => {
          if (url && !isSpecialUrl(url) && !isAlreadyProxied(url)) {
            return rewriteUrl(url, this.base, this.isEmbedded);
          }
          return url;
        }).join(' ');
        el.setAttribute("ping", proxiedPing);
      }
    } catch {}
    
    // Handle download attribute - let it work
    // Handle target="_blank"
    try {
      const target = el.getAttribute("target");
      if (target === "_blank" || target === "_new") {
        el.removeAttribute("target");
        el.setAttribute("data-proxy-target", target);
      }
    } catch {}
  }
}

class LinkRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "href");
    
    // Also handle src attribute (non-standard but sometimes used for stylesheets)
    this.safeRewrite(el, "src");
    
    // Also handle imagesrcset attribute on link elements
    try {
      const srcset = el.getAttribute("imagesrcset");
      if (srcset) {
        el.setAttribute("imagesrcset", rewriteSrcset(srcset, this.base, this.isEmbedded));
      }
    } catch {}
    
    // Handle as attribute for preload
    try {
      const asAttr = el.getAttribute("as");
      // These are fine, no need to change
    } catch {}
  }
}
  
class ImageRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "src");
    this.safeRewriteSrcset(el);
    // Lazy loading attributes
    this.safeRewrite(el, "data-src");
    this.safeRewrite(el, "data-lazy-src");
    this.safeRewrite(el, "data-original");
    this.safeRewrite(el, "data-lazy");
    this.safeRewrite(el, "data-url");
    this.safeRewrite(el, "data-image");
    this.safeRewrite(el, "data-thumb");
    this.safeRewrite(el, "data-full");
    this.safeRewrite(el, "data-bg");
    this.safeRewrite(el, "data-background");
    this.safeRewrite(el, "longdesc");
    this.safeRewrite(el, "usemap");
    // loading="lazy" is fine, no change needed
    }
  }
  
class SourceRewriter extends SafeRewriter {
      element(el) {
    this.safeRewrite(el, "src");
    this.safeRewriteSrcset(el);
    }
  }
  
class VideoRewriter extends SafeRewriter {
      element(el) {
    this.safeRewrite(el, "src");
    this.safeRewrite(el, "poster");
  }
}

class AudioRewriter extends SafeRewriter {
      element(el) {
    this.safeRewrite(el, "src");
          }
      }

class ScriptRewriter extends SafeRewriter {
  element(el) {
    this.safeRewrite(el, "src");
    // Remove integrity checks
    try {
      el.removeAttribute("integrity");
      el.removeAttribute("crossorigin");
      el.removeAttribute("nonce");
    } catch {}
  }
  
  // Handle inline script content - rewrite string URLs
  text(text) {
    try {
      const content = text.text;
      if (!content || content.trim().length === 0) return;
      
      // Only rewrite if content looks like it contains URL strings
      if (!content.includes('http://') && !content.includes('https://') && !content.includes('./') && !content.includes('/')) return;
      
      // Don't rewrite if it's our injected script
      if (content.includes('__PROXY_TARGET__') || content.includes('__proxyProxify__')) return;
      
      let rewritten = content;
      const prefix = this.isEmbedded ? "/?embedded=1&url=" : "/?url=";
      const base = this.base;
      
      // Rewrite fetch/XMLHttpRequest string URLs (common patterns)
      // fetch("https://...") or fetch('https://...')
      rewritten = rewritten.replace(/(fetch|XMLHttpRequest\.prototype\.open)\s*\(\s*(['"])([^'"]+)\2/gi, (m, fn, q, url) => {
        try {
          if (!url || url.includes('proxy.ikunbeautiful.workers.dev') || url.startsWith('data:') || url.startsWith('blob:')) return m;
          if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') || url.startsWith('./')) {
            const abs = new URL(url, base).toString();
            return `${fn}(${q}${prefix}${encodeURIComponent(abs)}${q}`;
          }
        } catch {}
        return m;
      });
      
      // Don't replace yet - we might break code
      // text.replace(rewritten);
    } catch {}
  }
}

class IFrameRewriter extends SafeRewriter {
  element(el) {
    this.safeRewrite(el, "src");
          
    // Handle srcdoc
    try {
          const srcdoc = el.getAttribute("srcdoc");
          if (srcdoc) {
        const base = this.base;
        const isEmbedded = this.isEmbedded;
        const rewritten = srcdoc
          .replace(/src\s*=\s*["']([^"']+)["']/gi, (m, url) => `src="${rewriteUrl(url, base, isEmbedded)}"`)
          .replace(/href\s*=\s*["']([^"']+)["']/gi, (m, url) => {
            if (isSpecialUrl(url)) return m;
            return `href="${rewriteUrl(url, base, isEmbedded)}"`;
                  });
        el.setAttribute("srcdoc", rewritten);
          }
    } catch {}
  
    // Remove sandbox restrictions that block our scripts
    try {
      const sandbox = el.getAttribute("sandbox");
      if (sandbox !== null) {
        el.setAttribute("sandbox", sandbox + " allow-scripts allow-same-origin");
      }
    } catch {}
  }
}

class FormRewriter extends SafeRewriter {
  element(el) {
    try {
      const action = el.getAttribute("action");
      const resolvedAction = action || this.base;
      if (!isSpecialUrl(resolvedAction) && !isAlreadyProxied(resolvedAction)) {
        el.setAttribute("action", rewriteUrl(resolvedAction, this.base, this.isEmbedded));
      }
    } catch {}
  }
}

// Handle button/input with formaction attribute
class FormActionRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "formaction");
    }
  }
  
class ObjectRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "data");
    this.safeRewrite(el, "codebase");
    }
  }
  
class EmbedRewriter extends SafeRewriter {
    element(el) {
    this.safeRewrite(el, "src");
    }
  }
  
class BaseRewriter extends SafeRewriter {
  element(el) {
    try { el.remove(); } catch {}
  }
}

class MetaRewriter extends SafeRewriter {
    element(el) {
    try {
      const httpEquiv = (el.getAttribute("http-equiv") || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      const content = el.getAttribute("content") || "";
      
      // Remove iframe busters
      if (httpEquiv === "x-frame-options") {
        el.remove();
        return;
      }
      
      // Sanitize CSP
      if (httpEquiv === "content-security-policy" || httpEquiv === "content-security-policy-report-only") {
        const newContent = content
          .replace(/frame-ancestors[^;]*(;|$)/gi, '')
          .replace(/frame-src[^;]*(;|$)/gi, '')
          .replace(/script-src[^;]*(;|$)/gi, '')
          .replace(/default-src[^;]*(;|$)/gi, '')
          .trim();
        if (newContent) {
          el.setAttribute("content", newContent);
        } else {
          el.remove();
        }
        return;
      }
      
      // Handle refresh redirects
      if (httpEquiv === "refresh" && content) {
        const match = content.match(/(\d+)\s*;\s*url\s*=\s*['"]?([^'">\s]+)/i);
        if (match) {
          el.setAttribute("content", `${match[1]};url=${rewriteUrl(match[2], this.base, this.isEmbedded)}`);
        }
      }
      
      // Remove referrer policy that might leak info
      if (name === "referrer") {
        el.remove();
      }
    } catch {}
    }
  }
  
  // --------------------
// Style Rewriters - MAX FIX VERSION
  // --------------------
function rewriteCSSUrls(css, base, isEmbedded) {
  if (!css || typeof css !== 'string') return css;
  
  const prefix = isEmbedded ? "/?embedded=1&url=" : "/?url=";
  
  try {
    // Rewrite url() - comprehensive regex that handles all formats
    css = css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (m, q, path) => {
      try {
        path = path.trim();
        if (!path || path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('#') || path.startsWith('about:')) return m;
        if (path.includes('proxy.ikunbeautiful.workers.dev')) return m;
        if (path.includes('/?url=') || path.includes('/?embedded=')) return m;
        const abs = new URL(path, base).toString();
        if (abs.includes('/?url=') || abs.includes('/?embedded=')) return m;
        return `url("${prefix}${encodeURIComponent(abs)}")`;
        } catch {
          return m;
        }
      });
    
    // Rewrite @import "url"
    css = css.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, path) => {
      try {
        path = path.trim();
        if (!path || path.startsWith('data:')) return m;
        if (path.includes('proxy.ikunbeautiful.workers.dev')) return m;
        if (path.includes('/?url=') || path.includes('/?embedded=')) return m;
        const abs = new URL(path, base).toString();
        if (abs.includes('/?url=') || abs.includes('/?embedded=')) return m;
        return `@import "${prefix}${encodeURIComponent(abs)}"`;
      } catch {
        return m;
      }
    });
    
    // Rewrite @import url()
    css = css.replace(/@import\s+url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (m, q, path) => {
      try {
        path = path.trim();
        if (!path || path.startsWith('data:')) return m;
        if (path.includes('proxy.ikunbeautiful.workers.dev')) return m;
        if (path.includes('/?url=') || path.includes('/?embedded=')) return m;
        const abs = new URL(path, base).toString();
        if (abs.includes('/?url=') || abs.includes('/?embedded=')) return m;
        return `@import url("${prefix}${encodeURIComponent(abs)}")`;
      } catch {
        return m;
      }
    });
    
    // Rewrite src in @font-face - handles format(), local(), etc.
    css = css.replace(/(@font-face\s*\{[^}]*)(src\s*:\s*)([^;}]+)/gi, (m, prefix_part, src_decl, src_val) => {
      try {
        const newSrcVal = src_val.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (um, uq, upath) => {
          try {
            upath = upath.trim();
            if (!upath || upath.startsWith('data:') || upath.startsWith('blob:')) return um;
            if (upath.includes('proxy.ikunbeautiful.workers.dev')) return um;
            if (upath.includes('/?url=') || upath.includes('/?embedded=')) return um;
            const abs = new URL(upath, base).toString();
            if (abs.includes('/?url=') || abs.includes('/?embedded=')) return um;
            return `url("${prefix}${encodeURIComponent(abs)}")`;
          } catch {
            return um;
          }
        });
        return prefix_part + src_decl + newSrcVal;
      } catch {
        return m;
      }
    });
    
    // Handle CSS variables with url values
    css = css.replace(/(--[a-zA-Z0-9_-]+\s*:\s*)url\(\s*(['"]?)([^'")\s]+)\2\s*\)/gi, (m, varPart, q, path) => {
      try {
        path = path.trim();
        if (!path || path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('#')) return m;
        if (path.includes('proxy.ikunbeautiful.workers.dev')) return m;
        if (path.includes('/?url=') || path.includes('/?embedded=')) return m;
        const abs = new URL(path, base).toString();
        if (abs.includes('/?url=') || abs.includes('/?embedded=')) return m;
        return `${varPart}url("${prefix}${encodeURIComponent(abs)}")`;
      } catch {
        return m;
      }
    });
    
    // Handle cursor url()
    css = css.replace(/(cursor\s*:\s*)([^;{}]+)/gi, (m, cursorPart, val) => {
      try {
        const newVal = val.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (um, uq, upath) => {
          try {
            upath = upath.trim();
            if (!upath || upath.startsWith('data:') || upath.startsWith('blob:')) return um;
            if (upath.includes('proxy.ikunbeautiful.workers.dev')) return um;
            if (upath.includes('/?url=') || upath.includes('/?embedded=')) return um;
            const abs = new URL(upath, base).toString();
            if (abs.includes('/?url=') || abs.includes('/?embedded=')) return um;
            return `url("${prefix}${encodeURIComponent(abs)}")`;
          } catch {
            return um;
          }
        });
        return cursorPart + newVal;
      } catch {
        return m;
      }
    });
    
  } catch {}
  
  return css;
}

class StyleRewriter extends SafeRewriter {
  element(el) {}
  text(text) {
    try {
      const content = text.text;
      if (content) {
        text.replace(rewriteCSSUrls(content, this.base, this.isEmbedded));
      }
    } catch {}
  }
}

class InlineStyleRewriter extends SafeRewriter {
  element(el) {
    try {
      const style = el.getAttribute("style");
      if (style) {
        const rewritten = rewriteCSSUrls(style, this.base, this.isEmbedded);
        if (rewritten !== style) {
          el.setAttribute("style", rewritten);
        }
      }
    } catch {}
  }
  }
  
  // --------------------
// SVG Handler (xlink:href)
// --------------------
class SVGRewriter extends SafeRewriter {
  element(el) {
    this.safeRewrite(el, "href");
    this.safeRewrite(el, "xlink:href");
  }
}

// --------------------
// Generic handler for any element with URL attributes
// --------------------
class GenericUrlRewriter extends SafeRewriter {
  element(el) {
    // Standard URL attributes
    const attrs = ['src', 'href', 'action', 'data', 'poster', 'background', 
                   'cite', 'longdesc', 'usemap', 'formaction', 'icon',
                   'manifest', 'codebase', 'archive', 'profile', 'code',
                   'classid', 'pluginspage', 'pluginurl'];
    
    // data-* attributes commonly used for lazy loading
    const dataAttrs = ['data-src', 'data-href', 'data-url', 'data-background',
                       'data-poster', 'data-image', 'data-thumb', 'data-full',
                       'data-lazy', 'data-lazy-src', 'data-original', 'data-bg',
                       'data-video', 'data-audio', 'data-load', 'data-link',
                       'data-source', 'data-srcset'];
    
    for (const attr of attrs.concat(dataAttrs)) {
      this.safeRewrite(el, attr);
    }
    
    // Handle srcset on any element that has it
    this.safeRewriteSrcset(el);
  }
}

// --------------------
// Inline event handler rewriter (onclick, etc.)
// --------------------
class EventHandlerRewriter extends SafeRewriter {
  element(el) {
    const eventAttrs = ['onclick', 'onload', 'onerror', 'onsubmit', 'onmouseover', 
                        'onmouseout', 'onfocus', 'onblur', 'onchange', 'oninput'];
    for (const attr of eventAttrs) {
      try {
        const val = el.getAttribute(attr);
        if (val && (val.includes("location") || val.includes("window.open") || 
                    val.includes("href") || val.includes("src"))) {
          // Wrap in try-catch to prevent errors
          el.setAttribute(attr, `try{${val}}catch(e){console.error('Event error:',e)}`);
        }
      } catch {}
    }
    }
  }
  
  // --------------------
// MEGA JavaScript Injection - MAX FIX VERSION
  // --------------------
  class InjectNavigationFix {
  constructor(targetUrl, isEmbedded = false) {
    this.targetUrl = targetUrl;
    this.isEmbedded = isEmbedded;
  }
  
    element(el) {
    const targetUrl = this.targetUrl;
    const isEmbedded = this.isEmbedded;
    
    let targetOrigin = '';
    let targetHost = '';
    try { 
      const u = new URL(targetUrl);
      targetOrigin = u.origin; 
      targetHost = u.host;
    } catch {}
    
    // The script is wrapped in try-catch at every level to prevent ANY error from breaking the page
    el.prepend(`
  <script>
  (function(){
'use strict';

// ============ MAX FIX PROXY SCRIPT ============
// Comprehensive interception of ALL browser APIs

try {

// ========== CONFIG ==========
var __PROXY_TARGET__ = ${JSON.stringify(targetUrl)};
var __PROXY_ORIGIN__ = ${JSON.stringify(targetOrigin)};
var __PROXY_HOST__ = ${JSON.stringify(targetHost)};
var __PROXY_EMBEDDED__ = ${isEmbedded};

// Store originals IMMEDIATELY before anything can modify them
var _Object = Object;
var _Array = Array;
var _String = String;
var _Number = Number;
var _Boolean = Boolean;
var _encodeURIComponent = encodeURIComponent;
var _decodeURIComponent = decodeURIComponent;
var _URL = URL;
var _Blob = Blob;
var _location = location;
var _history = history;
var _window = window;
var _document = document;
var _console = console;
var _setTimeout = setTimeout;
var _setInterval = setInterval;
var _Promise = Promise;
var _Reflect = typeof Reflect !== 'undefined' ? Reflect : null;
var _Proxy = typeof Proxy !== 'undefined' ? Proxy : null;

// Store REAL location properties BEFORE we override them
var _realLocationHref = _location.href;
var _realLocationSearch = _location.search;
var _realLocationPathname = _location.pathname;

// Track the current target URL across pushState/replaceState/popstate.
// Initialized from the config; updated by our history overrides.
var _currentTarget = __PROXY_TARGET__;

// _locationProxy will be set to a Proxy wrapping _location later.
// Until then, it points to the real _location for safety.
var _locationProxy = _location;

// Bind real location methods BEFORE any overrides touch _location
var _assign, _replace, _reload;
try {
  _assign = _location.assign ? _location.assign.bind(_location) : function(u) { _location.href = u; };
  _replace = _location.replace ? _location.replace.bind(_location) : function(u) { _location.href = u; };
  _reload = _location.reload ? _location.reload.bind(_location) : function() {};
} catch(e) {
  _assign = function(u) { _location.href = u; };
  _replace = function(u) { _location.href = u; };
  _reload = function() {};
}

// Store REAL parent window BEFORE we override parent/top/frameElement
// This is critical for postMessage communication with the embedding page
var _realParent = null;
try {
  if (_window.parent && _window.parent !== _window) {
    _realParent = _window.parent;
  }
} catch(e) {}

// ========== SAFE UTILITIES ==========
function safeStr(v) {
  try {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    return _String(v);
  } catch(e) { return ''; }
}

function getCurrentTarget() {
  // Primary: use the tracked _currentTarget variable (updated by our history overrides)
  // This is the most reliable method since window.location is unforgeable.
  try {
    if (_currentTarget) return _currentTarget;
  } catch(e) {}
  
  // Fallback: try to extract ?url= from the real location search
  // (works before replaceState rewrites the URL)
  try {
    var search = '';
    try {
      var realLoc = _Object.getOwnPropertyDescriptor(_Object.getPrototypeOf(_window), 'location');
      if (realLoc && realLoc.get) {
        search = realLoc.get.call(_window).search;
      }
    } catch(e) {
      search = _realLocationSearch || _location.search;
    }
    
    if (search) {
      var params = new URLSearchParams(search);
      var url = params.get('url');
      if (url) {
        try {
          if (url.indexOf('%') !== -1) {
            var decoded = _decodeURIComponent(url);
            if (decoded.indexOf('http') === 0) return decoded;
          }
        } catch(e) {}
        return url;
      }
    }
  } catch(e) {}
  
  return __PROXY_TARGET__;
}

function getCurrentOrigin() {
  try {
    return new _URL(getCurrentTarget()).origin;
  } catch(e) {
    return __PROXY_ORIGIN__;
  }
}

function getCurrentHost() {
  try {
    return new _URL(getCurrentTarget()).host;
  } catch(e) {
    return __PROXY_HOST__;
  }
}

function isSpecial(url) {
  if (!url) return true;
  var l = safeStr(url).toLowerCase().trim();
  if (l === '#' || l === '') return true;
  // Detect any non-HTTP(S) scheme (RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ))
  // Only http:, https:, ws:, wss: should be proxied; everything else is special.
  var colonIdx = l.indexOf(':');
  if (colonIdx > 0 && colonIdx < 20) {
    var scheme = l.substring(0, colonIdx);
    if (/^[a-z][a-z0-9+\-.]*$/.test(scheme) && scheme !== 'http' && scheme !== 'https' && scheme !== 'ws' && scheme !== 'wss') {
      return true;
    }
  }
  return false;
}

function isProxied(url) {
  if (!url) return false;
  var s = safeStr(url);
  if (s.indexOf('proxy.ikunbeautiful.workers.dev') !== -1) return true;
  if (s.indexOf('/?url=') !== -1 || s.indexOf('/?embedded=') !== -1) return true;
  // Also detect path-based format: /path?[...]url=encoded_target
  try {
    var testUrl = new _URL(s, 'https://proxy.ikunbeautiful.workers.dev');
    var urlParam = testUrl.searchParams.get('url');
    if (urlParam && (urlParam.indexOf('http://') === 0 || urlParam.indexOf('https://') === 0)) {
      return true;
    }
  } catch(e) {}
  return false;
}

// ========== MAIN PROXIFY FUNCTION ==========
function proxify(url, forceEmbedded) {
  try {
    url = safeStr(url).trim();
    if (!url || url.length === 0 || url.length > 8192) return url;
    if (isSpecial(url)) return url;
    if (isProxied(url)) return url;
    
    // Protocol-relative
    if (url.indexOf('//') === 0) url = 'https:' + url;
    
    var embedded = forceEmbedded !== undefined ? forceEmbedded : __PROXY_EMBEDDED__;
    var prefix = embedded ? '/?embedded=1&url=' : '/?url=';
    
    // Absolute URL
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
      if (isProxied(url)) return url;
      return prefix + _encodeURIComponent(url);
    }
    
    // Relative URL - resolve against current target
    var base = getCurrentTarget();
    try {
      var resolved = new _URL(url, base).href;
      if (isProxied(resolved)) return resolved;
      return prefix + _encodeURIComponent(resolved);
    } catch(e) {
      try {
        var resolved2 = new _URL(url, __PROXY_TARGET__).href;
        if (isProxied(resolved2)) return resolved2;
        return prefix + _encodeURIComponent(resolved2);
      } catch(e2) {
        // Last resort - prepend base origin
        try {
          var origin = getCurrentOrigin();
          if (url.indexOf('/') === 0) {
            return prefix + _encodeURIComponent(origin + url);
          }
          return prefix + _encodeURIComponent(origin + '/' + url);
        } catch(e3) {
          return url;
        }
      }
    }
  } catch(e) {
    return url;
  }
}

function resolveUrl(url) {
  try {
    url = safeStr(url).trim();
    if (!url) return url;
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;
    return new _URL(url, getCurrentTarget()).href;
  } catch(e) {
    try {
      var origin = getCurrentOrigin();
      if (url.indexOf('/') === 0) return origin + url;
      return origin + '/' + url;
    } catch(e2) {
      return url;
    }
  }
}

// Expose globally
_window.__proxyProxify__ = proxify;
_window.__proxyResolve__ = resolveUrl;
_window.__proxyGetTarget__ = getCurrentTarget;
_window.__PROXY_TARGET_URL__ = __PROXY_TARGET__;
_window.__PROXY_EMBEDDED__ = __PROXY_EMBEDDED__;
_window.__proxyIsSpecial__ = isSpecial;
_window.__proxyIsProxied__ = isProxied;

// ========== Handle direct window/location assignment ==========
// Override the setter for window.location to return our Proxy
try {
  var windowLocationDesc = _Object.getOwnPropertyDescriptor(_window, 'location') ||
                           _Object.getOwnPropertyDescriptor(_Object.getPrototypeOf(_window), 'location');
  if (windowLocationDesc) {
    _Object.defineProperty(_window, 'location', {
      get: function() { return _locationProxy; },
      set: function(v) { 
        try { 
          v = safeStr(v);
          if (v && !isSpecial(v) && !isProxied(v)) {
            v = proxify(v);
          }
          _assign(v);
        } catch(e) {
          try { _assign(v); } catch(e2) { _location.href = v; }
        }
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== ANTI-IFRAME-BUSTER (COMPREHENSIVE) ==========
// Detect if we are a sub-frame within a proxied page.
// If so, we should NOT override parent/top because the parent is also a
// proxied page and the page may rely on legitimate parent-child communication
// (e.g. game iframes communicating with their hosting page).
var _isSubFrame = false;
try {
  if (_realParent && _realParent !== _window) {
    try {
      // If the parent also has our proxy injected, it is a proxied sub-frame
      _isSubFrame = !!_realParent.__proxyProxify__;
    } catch(e) {
      // Cross-origin access will throw - parent is not same origin, so it is
      // either the external browser UI or an external page.  Override.
      _isSubFrame = false;
    }
  }
} catch(e) {}

if (!_isSubFrame) {
  // Top-level proxied frame: override parent/top to prevent iframe-busting
  try {
    _Object.defineProperty(_window, 'top', { get: function() { return _window; }, set: function(){}, configurable: false });
  } catch(e) {}
  try {
    _Object.defineProperty(_window, 'parent', { get: function() { return _window; }, set: function(){}, configurable: false });
  } catch(e) {}
  try {
    _Object.defineProperty(_window, 'frameElement', { get: function() { return null; }, set: function(){}, configurable: false });
  } catch(e) {}
}
// Always override self/frames/length for consistency
try {
  _Object.defineProperty(_window, 'self', { get: function() { return _window; }, set: function(){}, configurable: false });
} catch(e) {}
try {
  _Object.defineProperty(_window, 'frames', { get: function() { return _window; }, set: function(){}, configurable: false });
} catch(e) {}
try {
  _Object.defineProperty(_window, 'length', { get: function() { return 0; }, set: function(){}, configurable: false });
} catch(e) {}

// ========== DOCUMENT PROPERTY SPOOFING ==========
try {
  _Object.defineProperty(_document, 'domain', { 
    get: function() { return getCurrentHost(); },
    set: function() {},
    configurable: true 
  });
} catch(e) {}

try {
  _Object.defineProperty(_document, 'URL', { 
    get: function() { return getCurrentTarget(); },
    configurable: true 
  });
} catch(e) {}

try {
  _Object.defineProperty(_document, 'documentURI', { 
    get: function() { return getCurrentTarget(); },
    configurable: true 
  });
} catch(e) {}

try {
  _Object.defineProperty(_document, 'baseURI', { 
    get: function() { return getCurrentTarget(); },
    configurable: true 
  });
} catch(e) {}

try {
  _Object.defineProperty(_document, 'referrer', { 
    get: function() { 
      try {
        var current = getCurrentTarget();
        return new _URL(current).origin + '/';
      } catch(e) {
        return '';
      }
    },
    configurable: true 
  });
} catch(e) {}

// ========== LOCATION OBJECT COMPREHENSIVE OVERRIDE (PROXY-BASED) ==========
// Using a Proxy ensures ALL property reads/writes are intercepted reliably,
// even for non-configurable properties like pathname, search, hash, etc.
// Object.defineProperty silently fails for these on Location.prototype in browsers.
try {
  if (_Proxy) {
    _locationProxy = new _Proxy(_location, {
      get: function(target, prop, receiver) {
        try {
          // URL component properties - return values from the TARGET url
          if (prop === 'href') return getCurrentTarget();
          if (prop === 'origin') return getCurrentOrigin();
          if (prop === 'host') return getCurrentHost();
          if (prop === 'hostname') {
            try { return new _URL(getCurrentTarget()).hostname; } catch(e) { return ''; }
          }
          if (prop === 'pathname') {
            try { return new _URL(getCurrentTarget()).pathname; } catch(e) { return '/'; }
          }
          if (prop === 'search') {
            try { return new _URL(getCurrentTarget()).search; } catch(e) { return ''; }
          }
          if (prop === 'hash') {
            try { return new _URL(getCurrentTarget()).hash; } catch(e) { return ''; }
          }
          if (prop === 'protocol') {
            try { return new _URL(getCurrentTarget()).protocol; } catch(e) { return 'https:'; }
          }
          if (prop === 'port') {
            try { return new _URL(getCurrentTarget()).port; } catch(e) { return ''; }
          }
          
          // Navigation methods
          if (prop === 'assign') {
            return function(u) { try { return _assign(proxify(u)); } catch(e) { return _assign(u); } };
          }
          if (prop === 'replace') {
            return function(u) { try { return _replace(proxify(u)); } catch(e) { return _replace(u); } };
          }
          if (prop === 'reload') {
            return function(forceReload) { 
              try { return _reload(forceReload); } catch(e) {} 
            };
          }
          
          // String coercion
          if (prop === 'toString') {
            return function() { return getCurrentTarget(); };
          }
          if (prop === 'valueOf') {
            return function() { return getCurrentTarget(); };
          }
          if (prop === 'toJSON') {
            return function() {
              try {
                var u = new _URL(getCurrentTarget());
                return { href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash };
              } catch(e) { return getCurrentTarget(); }
            };
          }
          
          // Symbol support
          if (typeof Symbol !== 'undefined') {
            if (prop === Symbol.toPrimitive) {
              return function(hint) { return hint === 'number' ? NaN : getCurrentTarget(); };
            }
            try {
              if (prop === Symbol.for('nodejs.util.inspect.custom')) {
                return function() { return getCurrentTarget(); };
              }
            } catch(e) {}
          }
          
          // For ancestorOrigins and any other property, return from the real location
          var val = target[prop];
          if (typeof val === 'function') return val.bind(target);
          return val;
        } catch(e) {
          try { var v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } catch(e2) { return undefined; }
        }
      },
      set: function(target, prop, value) {
        try {
          if (prop === 'href') {
            try {
              _assign(proxify(safeStr(value)));
              // Update stored real location values after navigation
              _setTimeout(function() {
                try {
                  var protoLoc = _Object.getOwnPropertyDescriptor(_Object.getPrototypeOf(_window), 'location');
                  if (protoLoc && protoLoc.get) {
                    var realLoc = protoLoc.get.call(_window);
                    _realLocationHref = realLoc.href;
                    _realLocationSearch = realLoc.search;
                    _realLocationPathname = realLoc.pathname;
                  }
                } catch(e) {}
              }, 0);
            } catch(e) {
              _assign(safeStr(value));
            }
            return true;
          }
          if (prop === 'pathname') {
            try {
              var u = new _URL(getCurrentTarget());
              u.pathname = value;
              _assign(proxify(u.href));
            } catch(e) {}
            return true;
          }
          if (prop === 'search') {
            try {
              var u = new _URL(getCurrentTarget());
              u.search = value;
              _assign(proxify(u.href));
            } catch(e) {}
            return true;
          }
          if (prop === 'hash') {
            try {
              var u = new _URL(getCurrentTarget());
              u.hash = value;
              _assign(proxify(u.href));
            } catch(e) {}
            return true;
          }
          // Silently ignore read-only URL components
          if (prop === 'host' || prop === 'hostname' || prop === 'protocol' || prop === 'port' || prop === 'origin') {
            return true;
          }
          // For other properties, try to set on real location
          try { target[prop] = value; } catch(e) {}
          return true;
        } catch(e) {
          return true;
        }
      },
      has: function(target, prop) {
        return prop in target;
      },
      ownKeys: function(target) {
        return _Object.getOwnPropertyNames(target);
      },
      getOwnPropertyDescriptor: function(target, prop) {
        try {
          var desc = _Object.getOwnPropertyDescriptor(target, prop);
          if (desc) desc.configurable = true;
          return desc;
        } catch(e) { return undefined; }
      }
    });
  } else {
    // Fallback for environments without Proxy: try defineProperty approach (may silently fail)
    try { _location.assign = function(u) { try { return _assign(proxify(u)); } catch(e) { return _assign(u); } }; } catch(e) {}
    try { _location.replace = function(u) { try { return _replace(proxify(u)); } catch(e) { return _replace(u); } }; } catch(e) {}
    try { _location.toString = function() { return getCurrentTarget(); }; } catch(e) {}
    try { _location.valueOf = function() { return getCurrentTarget(); }; } catch(e) {}
  }
} catch(e) {}

// Also override methods on the real _location as a belt-and-suspenders approach
// (these may silently fail but help in some edge cases)
try { _location.assign = function(u) { try { return _assign(proxify(u)); } catch(e) { return _assign(u); } }; } catch(e) {}
try { _location.replace = function(u) { try { return _replace(proxify(u)); } catch(e) { return _replace(u); } }; } catch(e) {}
try { _location.toString = function() { return getCurrentTarget(); }; } catch(e) {}
try { _location.valueOf = function() { return getCurrentTarget(); }; } catch(e) {}

// ========== Location.prototype property overrides (best-effort) ==========
// In most browsers, location properties are [LegacyUnforgeable] own properties
// and cannot be overridden. These overrides are best-effort — they silently fail
// in Chromium/Firefox but may help in non-standard environments.
// The REAL fix for location.pathname is replaceState (see bottom of script).
try {
  var _LocationProto = _location.constructor && _location.constructor.prototype ? _location.constructor.prototype : null;
  if (!_LocationProto) {
    try { _LocationProto = _Object.getPrototypeOf(_location); } catch(e) {}
  }
  if (_LocationProto) {
    // Save original getters/setters for fallback
    var _origHrefDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'href');
    var _origPathnameDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'pathname');
    var _origSearchDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'search');
    var _origHashDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'hash');
    var _origHostDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'host');
    var _origHostnameDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'hostname');
    var _origOriginDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'origin');
    var _origProtocolDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'protocol');
    var _origPortDesc = _Object.getOwnPropertyDescriptor(_LocationProto, 'port');

    try {
      _Object.defineProperty(_LocationProto, 'href', {
        get: function() { try { return getCurrentTarget(); } catch(e) { return _origHrefDesc && _origHrefDesc.get ? _origHrefDesc.get.call(this) : ''; } },
        set: function(v) { try { _assign(proxify(safeStr(v))); } catch(e) { if (_origHrefDesc && _origHrefDesc.set) _origHrefDesc.set.call(this, v); } },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'pathname', {
        get: function() { try { return new _URL(getCurrentTarget()).pathname; } catch(e) { return _origPathnameDesc && _origPathnameDesc.get ? _origPathnameDesc.get.call(this) : '/'; } },
        set: function(v) { try { var u = new _URL(getCurrentTarget()); u.pathname = v; _assign(proxify(u.href)); } catch(e) { if (_origPathnameDesc && _origPathnameDesc.set) _origPathnameDesc.set.call(this, v); } },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'search', {
        get: function() { try { return new _URL(getCurrentTarget()).search; } catch(e) { return _origSearchDesc && _origSearchDesc.get ? _origSearchDesc.get.call(this) : ''; } },
        set: function(v) { try { var u = new _URL(getCurrentTarget()); u.search = v; _assign(proxify(u.href)); } catch(e) { if (_origSearchDesc && _origSearchDesc.set) _origSearchDesc.set.call(this, v); } },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'hash', {
        get: function() { try { return new _URL(getCurrentTarget()).hash; } catch(e) { return _origHashDesc && _origHashDesc.get ? _origHashDesc.get.call(this) : ''; } },
        set: function(v) { try { var u = new _URL(getCurrentTarget()); u.hash = v; _assign(proxify(u.href)); } catch(e) { if (_origHashDesc && _origHashDesc.set) _origHashDesc.set.call(this, v); } },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'host', {
        get: function() { try { return getCurrentHost(); } catch(e) { return _origHostDesc && _origHostDesc.get ? _origHostDesc.get.call(this) : ''; } },
        set: function(v) { /* read-only for proxy */ },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'hostname', {
        get: function() { try { return new _URL(getCurrentTarget()).hostname; } catch(e) { return _origHostnameDesc && _origHostnameDesc.get ? _origHostnameDesc.get.call(this) : ''; } },
        set: function(v) { /* read-only for proxy */ },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'origin', {
        get: function() { try { return getCurrentOrigin(); } catch(e) { return _origOriginDesc && _origOriginDesc.get ? _origOriginDesc.get.call(this) : ''; } },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'protocol', {
        get: function() { try { return new _URL(getCurrentTarget()).protocol; } catch(e) { return _origProtocolDesc && _origProtocolDesc.get ? _origProtocolDesc.get.call(this) : 'https:'; } },
        set: function(v) { /* read-only for proxy */ },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    try {
      _Object.defineProperty(_LocationProto, 'port', {
        get: function() { try { return new _URL(getCurrentTarget()).port; } catch(e) { return _origPortDesc && _origPortDesc.get ? _origPortDesc.get.call(this) : ''; } },
        set: function(v) { /* read-only for proxy */ },
        configurable: true, enumerable: true
      });
    } catch(e) {}

    // Override toString and valueOf on the prototype too
    try {
      _LocationProto.toString = function() { try { return getCurrentTarget(); } catch(e) { return ''; } };
    } catch(e) {}
    try {
      _LocationProto.valueOf = function() { try { return getCurrentTarget(); } catch(e) { return ''; } };
    } catch(e) {}
  }
} catch(e) {}

// ========== document.location (same as window.location, returns Proxy) ==========
try {
  _Object.defineProperty(_document, 'location', {
    get: function() { return _locationProxy; },
    set: function(v) { 
      try { _assign(proxify(safeStr(v))); } catch(e) { try { _assign(safeStr(v)); } catch(e2) {} }
    },
    configurable: true
  });
} catch(e) {}

// ========== HISTORY OVERRIDES ==========
try {
  var _pushState = _history.pushState.bind(_history);
  var _replaceState = _history.replaceState.bind(_history);
  var _go = _history.go ? _history.go.bind(_history) : function(){};
  var _back = _history.back ? _history.back.bind(_history) : function(){};
  var _forward = _history.forward ? _history.forward.bind(_history) : function(){};
  
  // Helper: build proxy URL in format /target/path?[target_search&][embedded=1&]url=encoded_target
  // The path MUST match the target's path so that location.pathname returns the
  // correct value (location.pathname is unforgeable in browsers).
  function buildProxyPath(targetHref) {
    try {
      var tUrl = new _URL(targetHref);
      var parts = [];
      if (tUrl.search) parts.push(tUrl.search.slice(1));
      if (__PROXY_EMBEDDED__) parts.push('embedded=1');
      parts.push('url=' + _encodeURIComponent(targetHref));
      return tUrl.pathname + '?' + parts.join('&') + (tUrl.hash || '');
    } catch(e) {
      return null;
    }
  }
  
  _history.pushState = function(s, t, u) { 
    try { 
      if (u) {
        var uStr = safeStr(u);
        // If it's already a proxied URL (has ?url= param), extract the target
        if (isProxied(uStr)) {
          try {
            var pUrl = new _URL(uStr, _realLocationHref);
            var extracted = pUrl.searchParams.get('url');
            if (extracted) {
              _currentTarget = extracted.indexOf('%') !== -1 ? _decodeURIComponent(extracted) : extracted;
              var built = buildProxyPath(_currentTarget);
              if (built) u = built;
            }
          } catch(e) {}
        } else {
          // Resolve relative URL against current target to get new target
          try {
            var resolved = new _URL(uStr, _currentTarget).href;
            _currentTarget = resolved;
            var built = buildProxyPath(resolved);
            if (built) u = built;
          } catch(e) {}
        }
      }
    } catch(e) {}
    try {
      var result = _pushState(s, t, u);
      notifyParent();
      return result;
    } catch(e) {
      return _pushState(s, t, u);
    }
  };
  _history.replaceState = function(s, t, u) {
    try { 
      if (u) {
        var uStr = safeStr(u);
        if (isProxied(uStr)) {
          try {
            var pUrl = new _URL(uStr, _realLocationHref);
            var extracted = pUrl.searchParams.get('url');
            if (extracted) {
              _currentTarget = extracted.indexOf('%') !== -1 ? _decodeURIComponent(extracted) : extracted;
              var built = buildProxyPath(_currentTarget);
              if (built) u = built;
            }
          } catch(e) {}
        } else {
          try {
            var resolved = new _URL(uStr, _currentTarget).href;
            _currentTarget = resolved;
            var built = buildProxyPath(resolved);
            if (built) u = built;
          } catch(e) {}
        }
      }
    } catch(e) {}
    try {
      var result = _replaceState(s, t, u);
      notifyParent();
      return result;
    } catch(e) {
      return _replaceState(s, t, u);
    }
  };
  
  // Override history.go/back/forward to notify parent
  _history.go = function(n) {
    var result = _go(n);
    _setTimeout(notifyParent, 100);
    return result;
  };
  _history.back = function() {
    var result = _back();
    _setTimeout(notifyParent, 100);
    return result;
  };
  _history.forward = function() {
    var result = _forward();
    _setTimeout(notifyParent, 100);
    return result;
  };
  
  // CRITICAL: Also override on History.prototype to catch frameworks (e.g. Next.js)
  // that call History.prototype.pushState.call(history, ...) or cache the native method
  // before our instance-level override. Without this, the ?url= param gets stripped.
  try {
    History.prototype.pushState = _history.pushState;
    History.prototype.replaceState = _history.replaceState;
  } catch(e) {}
} catch(e) {}

// ========== WINDOW.OPEN ==========
try {
  var _open = _window.open ? _window.open.bind(_window) : function(){};
  _window.open = function(url, name, specs) {
    try {
      if (!url || url === 'about:blank') return _open(url, name, specs);
      
      var resolved = resolveUrl(url);
      
      if (__PROXY_EMBEDDED__ && _realParent) {
        try {
          _realParent.postMessage({ type: 'PROXY_NEW_TAB', url: resolved }, '*');
          // Return a mock window object
            return {
              closed: false,
              close: function() {
              try { _realParent.postMessage({ type: 'PROXY_CLOSE_TAB' }, '*'); } catch(ex) {}
              },
              focus: function() {},
            blur: function() {},
            postMessage: function() {},
            location: { href: resolved }
            };
        } catch(e) {}
          }
      
      return _open(proxify(url), name, specs);
    } catch(e) {
      return _open(url, name, specs);
    }
  };
} catch(e) {}

// ========== WINDOW.CLOSE ==========
try {
  var _close = _window.close ? _window.close.bind(_window) : function(){};
  _window.close = function() {
    if (__PROXY_EMBEDDED__ && _realParent) {
      try {
        _realParent.postMessage({ type: 'PROXY_CLOSE_TAB' }, '*');
          return;
      } catch(e) {}
      }
      return _close();
    };
} catch(e) {}

// ========== ELEMENT SETATTRIBUTE ==========
try {
  var _setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    try {
      var n = safeStr(name).toLowerCase();
      // URL attributes
      if ((n === 'src' || n === 'href' || n === 'action' || n === 'data' || n === 'poster' || 
           n === 'formaction' || n === 'xlink:href' || n === 'ping' || n === 'longdesc' ||
           n === 'usemap' || n === 'codebase' || n === 'cite' || n === 'background' ||
           n === 'manifest' || n === 'icon') && value) {
        if (!isSpecial(value) && !isProxied(value)) {
          value = proxify(value);
        }
      } 
      // Srcset attribute
      else if (n === 'srcset' && value) {
        value = safeStr(value).split(/,\\s+/).map(function(s) {
          var parts = s.trim().split(/\\s+/);
          if (parts[0] && !isSpecial(parts[0]) && !isProxied(parts[0])) {
            parts[0] = proxify(parts[0]);
          }
          return parts.join(' ');
        }).join(', ');
      }
      // data-* URL attributes
      else if (n.indexOf('data-') === 0 && value) {
        var urlDataAttrs = ['data-src', 'data-href', 'data-url', 'data-background', 'data-poster',
                           'data-image', 'data-thumb', 'data-full', 'data-lazy', 'data-lazy-src',
                           'data-original', 'data-bg', 'data-video', 'data-audio', 'data-link',
                           'data-source', 'data-load'];
        if (urlDataAttrs.indexOf(n) !== -1) {
          if (!isSpecial(value) && !isProxied(value)) {
            value = proxify(value);
          }
        }
      }
      // Style attribute with url()
      else if (n === 'style' && value && value.indexOf('url(') !== -1) {
        value = rewriteCssUrls(value);
      }
    } catch(e) {}
    return _setAttribute.call(this, name, value);
  };
} catch(e) {}

// ========== ELEMENT setAttributeNS (for SVG xlink:href etc) ==========
try {
  var _setAttributeNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function(ns, name, value) {
    try {
      var localName = name.indexOf(':') !== -1 ? name.split(':')[1] : name;
      if ((localName === 'href' || name === 'xlink:href') && value) {
        if (!isSpecial(value) && !isProxied(value)) {
          value = proxify(value);
        }
      }
    } catch(e) {}
    return _setAttributeNS.call(this, ns, name, value);
  };
} catch(e) {}

// ========== setAttributeNode / setAttributeNodeNS ==========
try {
  var _setAttributeNode = Element.prototype.setAttributeNode;
  Element.prototype.setAttributeNode = function(attr) {
    try {
      var name = attr.name.toLowerCase();
      var value = attr.value;
      if ((name === 'src' || name === 'href' || name === 'action' || name === 'data' || 
           name === 'poster' || name === 'formaction') && value) {
        if (!isSpecial(value) && !isProxied(value)) {
          attr.value = proxify(value);
        }
      }
    } catch(e) {}
    return _setAttributeNode.call(this, attr);
  };
} catch(e) {}

try {
  var _setAttributeNodeNS = Element.prototype.setAttributeNodeNS;
  if (_setAttributeNodeNS) {
    Element.prototype.setAttributeNodeNS = function(attr) {
      try {
        var localName = attr.localName || attr.name;
        var value = attr.value;
        if (localName === 'href' && value) {
          if (!isSpecial(value) && !isProxied(value)) {
            attr.value = proxify(value);
          }
        }
      } catch(e) {}
      return _setAttributeNodeNS.call(this, attr);
    };
  }
} catch(e) {}

// ========== ELEMENT getAttribute override for location-checking scripts ==========
try {
  var _getAttribute = Element.prototype.getAttribute;
  Element.prototype.getAttribute = function(name) {
    var val = _getAttribute.call(this, name);
    // Don't modify the return value - this could break scripts
    return val;
  };
} catch(e) {}

// ========== PROPERTY OVERRIDES ==========
var srcElements = ['HTMLImageElement', 'HTMLScriptElement', 'HTMLIFrameElement', 
                   'HTMLVideoElement', 'HTMLAudioElement', 'HTMLSourceElement',
                   'HTMLEmbedElement', 'HTMLTrackElement', 'HTMLMediaElement', 'HTMLInputElement'];

srcElements.forEach(function(name) {
  try {
    var El = _window[name];
    if (!El || !El.prototype) return;
    var desc = _Object.getOwnPropertyDescriptor(El.prototype, 'src');
    if (desc && desc.set) {
      var _set = desc.set;
      var _get = desc.get;
      _Object.defineProperty(El.prototype, 'src', {
        set: function(v) { 
          try { 
            if (v && !isSpecial(v) && !isProxied(v)) {
              v = proxify(v); 
            }
          } catch(e) {} 
          _set.call(this, v); 
        },
        get: _get,
        configurable: true
      });
    }
  } catch(e) {}
});

// href properties with comprehensive handling
['HTMLAnchorElement', 'HTMLLinkElement', 'HTMLAreaElement', 'HTMLBaseElement'].forEach(function(name) {
  try {
    var El = _window[name];
    if (!El || !El.prototype) return;
    var desc = _Object.getOwnPropertyDescriptor(El.prototype, 'href');
    if (desc && desc.set) {
      var _set = desc.set;
      var _get = desc.get;
      _Object.defineProperty(El.prototype, 'href', {
        set: function(v) { 
          try { 
            if (v && !isSpecial(v) && !isProxied(v)) {
              v = proxify(v); 
            }
          } catch(e) {} 
          _set.call(this, v); 
        },
        get: _get,
        configurable: true
      });
    }
  } catch(e) {}
});

// ========== ANCHOR ELEMENT URL PROPERTIES ==========
// Override origin, host, hostname, pathname, search, hash, protocol, port
['origin', 'host', 'hostname', 'pathname', 'search', 'hash', 'protocol', 'port'].forEach(function(prop) {
  try {
    var desc = _Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, prop);
    if (desc && desc.get) {
      var _get = desc.get;
      _Object.defineProperty(HTMLAnchorElement.prototype, prop, {
        get: function() {
          try {
            var href = this.getAttribute('href');
            if (href && !isSpecial(href)) {
              var resolved = resolveUrl(href);
              return new _URL(resolved)[prop];
            }
          } catch(e) {}
          return _get.call(this);
        },
        set: desc.set,
        configurable: true
      });
    }
  } catch(e) {}
});

// form action
try {
  var formDesc = _Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action');
  if (formDesc && formDesc.set) {
    var _setAction = formDesc.set;
    var _getAction = formDesc.get;
    _Object.defineProperty(HTMLFormElement.prototype, 'action', {
      set: function(v) { 
        try { 
          if (v && !isSpecial(v) && !isProxied(v)) {
            v = proxify(v); 
          }
        } catch(e) {} 
        _setAction.call(this, v); 
      },
      get: _getAction,
      configurable: true
    });
  }
} catch(e) {}

// object data
try {
  var objDesc = _Object.getOwnPropertyDescriptor(HTMLObjectElement.prototype, 'data');
  if (objDesc && objDesc.set) {
    var _setData = objDesc.set;
    var _getData = objDesc.get;
    _Object.defineProperty(HTMLObjectElement.prototype, 'data', {
      set: function(v) { 
        try { 
          if (v && !isSpecial(v) && !isProxied(v)) {
            v = proxify(v); 
          }
        } catch(e) {} 
        _setData.call(this, v); 
      },
      get: _getData,
      configurable: true
    });
  }
} catch(e) {}

// video poster
try {
  var posterDesc = _Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'poster');
  if (posterDesc && posterDesc.set) {
    var _setPoster = posterDesc.set;
    var _getPoster = posterDesc.get;
    _Object.defineProperty(HTMLVideoElement.prototype, 'poster', {
      set: function(v) { 
        try { 
          if (v && !isSpecial(v) && !isProxied(v)) {
            v = proxify(v); 
          }
        } catch(e) {} 
        _setPoster.call(this, v); 
      },
      get: _getPoster,
      configurable: true
    });
  }
} catch(e) {}

// ========== srcObject for media elements ==========
try {
  var srcObjDesc = _Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (srcObjDesc) {
    // Don't modify srcObject - it's for MediaStream, not URLs
  }
} catch(e) {}

// ========== URL Constructor Override ==========
// Handle new URL(path, base) where base might be location or document.URL
try {
  var _URLConstructor = _URL;
  _window.URL = function(url, base) {
    // If base is location-like, use the target URL
    if (base === _location || base === _locationProxy || base === _document.URL || base === _document.baseURI ||
        (typeof base === 'string' && base.indexOf('proxy.ikunbeautiful.workers.dev') !== -1)) {
      base = getCurrentTarget();
    }
    // If base is a URL object that's proxied, extract the real URL
    if (base && typeof base === 'object' && base.href && base.href.indexOf('/?url=') !== -1) {
      try {
        var match = base.href.match(/[?&]url=([^&]+)/);
        if (match) base = _decodeURIComponent(match[1]);
      } catch(e) {}
    }
    return new _URLConstructor(url, base);
  };
  _window.URL.prototype = _URLConstructor.prototype;
  _window.URL.createObjectURL = _URLConstructor.createObjectURL ? _URLConstructor.createObjectURL.bind(_URLConstructor) : function(){};
  _window.URL.revokeObjectURL = _URLConstructor.revokeObjectURL ? _URLConstructor.revokeObjectURL.bind(_URLConstructor) : function(){};
  _window.URL.canParse = _URLConstructor.canParse ? _URLConstructor.canParse.bind(_URLConstructor) : undefined;
} catch(e) {}

// ========== FETCH ==========
try {
  var _fetch = _window.fetch ? _window.fetch.bind(_window) : null;
  if (_fetch) {
    _window.fetch = function(input, init) {
      try {
        if (typeof input === 'string') {
          if (!isSpecial(input) && !isProxied(input)) {
            input = proxify(input);
          }
        } else if (input && input instanceof _URL) {
          // URL object
          var urlStr = input.href;
          if (!isSpecial(urlStr) && !isProxied(urlStr)) {
            input = proxify(urlStr);
          }
        } else if (input && typeof input === 'object') {
          if (input.url && !isSpecial(input.url) && !isProxied(input.url)) {
            input = new Request(proxify(input.url), input);
          } else if (input instanceof Request) {
            var url = input.url;
            if (url && !isSpecial(url) && !isProxied(url)) {
              input = new Request(proxify(url), input);
            }
          }
        }
      } catch(e) {}
      return _fetch(input, init);
    };
  }
} catch(e) {}

// ========== XMLHttpRequest ==========
try {
  var _XHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    // Store original URL for responseURL spoofing
    try {
      this.__originalUrl__ = url;
      if (url && !isSpecial(url) && !isProxied(url)) {
        url = proxify(url); 
      }
    } catch(e) {}
    return _XHROpen.call(this, method, url, async !== false, user, pass);
  };
  
  // Override responseURL to return original URL
  try {
    var respUrlDesc = _Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
    if (respUrlDesc && respUrlDesc.get) {
      _Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', {
        get: function() {
          if (this.__originalUrl__) {
            return resolveUrl(this.__originalUrl__);
          }
          return respUrlDesc.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}
} catch(e) {}

// ========== HTMLInputElement/HTMLButtonElement formAction ==========
try {
  ['HTMLInputElement', 'HTMLButtonElement'].forEach(function(name) {
    try {
      var El = _window[name];
      if (!El || !El.prototype) return;
      var desc = _Object.getOwnPropertyDescriptor(El.prototype, 'formAction');
      if (desc && desc.set) {
        var _set = desc.set;
        var _get = desc.get;
        _Object.defineProperty(El.prototype, 'formAction', {
          set: function(v) {
            try {
              if (v && !isSpecial(v) && !isProxied(v)) {
                v = proxify(v);
              }
            } catch(e) {}
            _set.call(this, v);
          },
          get: _get,
          configurable: true
        });
      }
    } catch(e) {}
  });
} catch(e) {}

// ========== Form submit() method ==========
try {
  var _formSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function() {
    try {
      var action = this.getAttribute('action');
      if (!action || (!isProxied(action) && !isSpecial(action))) {
        _setAttribute.call(this, 'action', proxify(action || getCurrentTarget()));
      }
    } catch(e) {}
    return _formSubmit.call(this);
  };
} catch(e) {}

// ========== Form requestSubmit() method ==========
try {
  if (HTMLFormElement.prototype.requestSubmit) {
    var _requestSubmit = HTMLFormElement.prototype.requestSubmit;
    HTMLFormElement.prototype.requestSubmit = function(submitter) {
      try {
        var action = this.getAttribute('action');
        if (!action || (!isProxied(action) && !isSpecial(action))) {
          _setAttribute.call(this, 'action', proxify(action || getCurrentTarget()));
        }
        // Check submitter formAction
        if (submitter && submitter.formAction) {
          var fa = submitter.getAttribute('formaction');
          if (fa && !isProxied(fa) && !isSpecial(fa)) {
            _setAttribute.call(submitter, 'formaction', proxify(fa));
          }
        }
      } catch(e) {}
      return _requestSubmit.call(this, submitter);
    };
  }
} catch(e) {}

// ========== WebSocket ==========
try {
  if (_window.WebSocket) {
    var _WebSocket = _window.WebSocket;
    
    // Helper: extract the innermost real WebSocket target from a possibly
    // double/triple-proxied URL like wss://proxy.../ws=wss%3A%2F%2Fproxy.../ws=...
    function unwrapWsTarget(wsUrl) {
      for (var i = 0; i < 5; i++) {
        if (wsUrl.indexOf('proxy.ikunbeautiful.workers.dev') === -1 && wsUrl.indexOf('/?ws=') === -1) break;
        try {
          var parse = wsUrl;
          if (parse.indexOf('ws://') === 0) parse = 'http://' + parse.slice(5);
          else if (parse.indexOf('wss://') === 0) parse = 'https://' + parse.slice(6);
          var inner = new _URL(parse).searchParams.get('ws');
          if (inner) { wsUrl = inner; continue; }
        } catch(e) {}
        break;
      }
      return wsUrl;
    }
    
    _window.WebSocket = function(url, protocols) {
      try {
        var resolvedWsUrl = safeStr(url).trim();
        
        // If the URL is already proxied (contains proxy domain or /?ws=),
        // extract the real target to prevent double-proxying.
        if (resolvedWsUrl && (resolvedWsUrl.indexOf('/?ws=') !== -1 || resolvedWsUrl.indexOf('proxy.ikunbeautiful.workers.dev') !== -1)) {
          resolvedWsUrl = unwrapWsTarget(resolvedWsUrl);
          // If unwrapping yielded a non-proxy URL, fall through to proxy it properly below.
          // If it's still a proxy URL (couldn't unwrap), pass through directly.
          if (resolvedWsUrl.indexOf('proxy.ikunbeautiful.workers.dev') !== -1) {
            if (protocols !== undefined) return new _WebSocket(resolvedWsUrl, protocols);
            return new _WebSocket(resolvedWsUrl);
          }
        }
        
        if (resolvedWsUrl && !isSpecial(resolvedWsUrl)) {
          // Handle protocol-relative
          if (resolvedWsUrl.indexOf('//') === 0) {
            resolvedWsUrl = 'wss:' + resolvedWsUrl;
          }
          // Handle relative paths
          if (resolvedWsUrl.indexOf('ws://') !== 0 && resolvedWsUrl.indexOf('wss://') !== 0 &&
              resolvedWsUrl.indexOf('http://') !== 0 && resolvedWsUrl.indexOf('https://') !== 0) {
            var base = getCurrentTarget();
            try {
              resolvedWsUrl = new _URL(resolvedWsUrl, base).href;
            } catch(e) {
              resolvedWsUrl = getCurrentOrigin() + (resolvedWsUrl.indexOf('/') === 0 ? '' : '/') + resolvedWsUrl;
            }
          }
          // Convert http(s) to ws(s) if needed
          if (resolvedWsUrl.indexOf('http://') === 0) {
            resolvedWsUrl = 'ws://' + resolvedWsUrl.slice(7);
          } else if (resolvedWsUrl.indexOf('https://') === 0) {
            resolvedWsUrl = 'wss://' + resolvedWsUrl.slice(8);
          }
          // Don't proxy WebSocket URLs that already point to our proxy
          if (resolvedWsUrl.indexOf('proxy.ikunbeautiful.workers.dev') !== -1) {
            if (protocols !== undefined) return new _WebSocket(resolvedWsUrl, protocols);
            return new _WebSocket(resolvedWsUrl);
          }
          // Route through proxy WebSocket endpoint
          var proxyWsProtocol = _realLocationHref.indexOf('https://') === 0 ? 'wss://' : 'ws://';
          var proxyHost = _realLocationHref.split('/')[2]; // e.g. proxy.ikunbeautiful.workers.dev
          var proxyWsUrl = proxyWsProtocol + proxyHost + '/?ws=' + _encodeURIComponent(resolvedWsUrl);
          if (protocols !== undefined) {
            return new _WebSocket(proxyWsUrl, protocols);
          }
          return new _WebSocket(proxyWsUrl);
        }
      } catch(e) {
        // Fallback to direct connection
      }
      if (protocols !== undefined) {
        return new _WebSocket(url, protocols);
      }
      return new _WebSocket(url);
    };
    _window.WebSocket.prototype = _WebSocket.prototype;
    _window.WebSocket.CONNECTING = _WebSocket.CONNECTING;
    _window.WebSocket.OPEN = _WebSocket.OPEN;
    _window.WebSocket.CLOSING = _WebSocket.CLOSING;
    _window.WebSocket.CLOSED = _WebSocket.CLOSED;
  }
} catch(e) {}

// ========== Worker ==========
try {
  if (_window.Worker) {
    var _Worker = _window.Worker;
    _window.Worker = function(url, opts) {
      try { 
        if (url && !isSpecial(url) && !isProxied(url)) {
          url = proxify(url, false); // Workers can't be embedded
        }
      } catch(e) {}
      return new _Worker(url, opts);
    };
    _window.Worker.prototype = _Worker.prototype;
  }
} catch(e) {}

// ========== SharedWorker ==========
try {
  if (_window.SharedWorker) {
    var _SharedWorker = _window.SharedWorker;
    _window.SharedWorker = function(url, opts) {
      try { 
        if (url && !isSpecial(url) && !isProxied(url)) {
          url = proxify(url, false);
        }
      } catch(e) {}
      return new _SharedWorker(url, opts);
    };
    _window.SharedWorker.prototype = _SharedWorker.prototype;
  }
} catch(e) {}

// ========== EventSource ==========
try {
  if (_window.EventSource) {
    var _EventSource = _window.EventSource;
    _window.EventSource = function(url, cfg) {
      try { 
        if (url && !isSpecial(url) && !isProxied(url)) {
          url = proxify(url);
        }
      } catch(e) {}
      return new _EventSource(url, cfg);
    };
    _window.EventSource.prototype = _EventSource.prototype;
  }
} catch(e) {}
  
// ========== sendBeacon ==========
try {
  if (navigator && navigator.sendBeacon) {
    var _sendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try { 
        if (url && !isSpecial(url) && !isProxied(url)) {
          url = proxify(url);
        }
      } catch(e) {}
      return _sendBeacon(url, data);
    };
  }
} catch(e) {}

// ========== Service Worker (BLOCK) ==========
// Single fake object, resolved ready promise, no unhandled rejections
try {
  if (navigator && navigator.serviceWorker) {
    var _fakeActiveWorker = {
      state: 'activated', scriptURL: '/sw-noop.js',
      addEventListener: function() {}, removeEventListener: function() {},
      postMessage: function() {}, onstatechange: null,
      onerror: null
    };
    var _fakeRegistration = { 
      installing: null, waiting: null, active: _fakeActiveWorker, scope: '/',
      unregister: function() { return _Promise.resolve(true); },
      update: function() { return _Promise.resolve(_fakeRegistration); },
      addEventListener: function() {}, removeEventListener: function() {},
      onupdatefound: null,
      navigationPreload: { 
        enable: function(){ return _Promise.resolve(); }, 
        disable: function(){ return _Promise.resolve(); }, 
        setHeaderValue: function(){ return _Promise.resolve(); }, 
        getState: function(){ return _Promise.resolve({enabled:false,headerValue:''}); } 
      }
    };
    var _fakeSW = {
      register: function() { return _Promise.resolve(_fakeRegistration); },
      getRegistration: function() { return _Promise.resolve(_fakeRegistration); },
      getRegistrations: function() { return _Promise.resolve([_fakeRegistration]); },
      ready: _Promise.resolve(_fakeRegistration),
      controller: _fakeActiveWorker,
      addEventListener: function() {},
      removeEventListener: function() {},
      startMessages: function() {},
      oncontrollerchange: null,
      onmessage: null,
      onmessageerror: null
    };
    _Object.defineProperty(navigator, 'serviceWorker', {
      get: function() { return _fakeSW; },
      configurable: true
    });
  }
} catch(e) {}

// ========== Image Constructor ==========
try {
  var _Image = _window.Image;
  _window.Image = function(w, h) { 
    var img = w !== undefined ? (h !== undefined ? new _Image(w, h) : new _Image(w)) : new _Image();
    // src is handled by property override
      return img;
    };
  _window.Image.prototype = _Image.prototype;
} catch(e) {}

// ========== Audio constructor ==========
try {
  if (_window.Audio) {
    var _Audio = _window.Audio;
    _window.Audio = function(src) {
      if (src && !isSpecial(src) && !isProxied(src)) {
        src = proxify(src);
      }
      return src ? new _Audio(src) : new _Audio();
    };
    _window.Audio.prototype = _Audio.prototype;
  }
} catch(e) {}

// ========== importScripts (for workers) ==========
try {
  if (typeof importScripts !== 'undefined') {
    var _importScripts = importScripts;
    importScripts = function() {
      var args = _Array.prototype.slice.call(arguments).map(function(url) {
        try {
          if (url && !isSpecial(url) && !isProxied(url)) {
            return proxify(url, false);
          }
        } catch(e) {}
        return url;
      });
      return _importScripts.apply(this, args);
    };
  }
} catch(e) {}

// ========== Worklets (AudioWorklet, PaintWorklet, AnimationWorklet) ==========
try {
  ['audioWorklet', 'paintWorklet', 'animationWorklet'].forEach(function(workletName) {
    try {
      var worklet = navigator[workletName] || (CSS && CSS[workletName]);
      if (worklet && worklet.addModule) {
        var _addModule = worklet.addModule.bind(worklet);
        worklet.addModule = function(url, options) {
          try {
            if (url && !isSpecial(url) && !isProxied(url)) {
              url = proxify(url, false);
            }
          } catch(e) {}
          return _addModule(url, options);
        };
      }
    } catch(e) {}
  });
} catch(e) {}

// ========== import.meta.url spoofing ==========
// Can't directly override import.meta, but we expose a helper
try {
  _window.__getImportMetaUrl__ = function() {
    return getCurrentTarget();
  };
} catch(e) {}

// ========== Handle import maps (type="importmap") ==========
// Import maps are handled at the script element level by our MutationObserver

// ========== Handle location being accessed via bracket notation ==========
// e.g., window["location"], this["location"]
try {
  var windowProxy = new _Proxy(_window, {
    get: function(target, prop) {
      if (prop === 'location') return _locationProxy;
      return target[prop];
    },
    set: function(target, prop, value) {
      if (prop === 'location') {
        try { _assign(proxify(safeStr(value))); } catch(e) { try { _assign(safeStr(value)); } catch(e2) {} }
        return true;
      }
      target[prop] = value;
      return true;
    }
  });
  // Can't replace window, but the handler ensures window.location is our Proxy version
} catch(e) {}

// ========== JSON.stringify on location should return target URL ==========
try {
  _location.toJSON = function() { 
    try {
      var u = new _URL(getCurrentTarget());
      return {
        href: u.href,
        origin: u.origin,
        protocol: u.protocol,
        host: u.host,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash
      };
    } catch(e) {
      return getCurrentTarget();
    }
  };
} catch(e) {}

// ========== Handle location being spread or Object.assign'd ==========
try {
  if (_Object.assign) {
    var _assign_orig = _Object.assign;
    _Object.assign = function(target, ...sources) {
      // Check if any source is location or our location proxy
      var modifiedSources = sources.map(function(src) {
        if (src === _location || src === _locationProxy) {
          try {
            var u = new _URL(getCurrentTarget());
            return { href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash };
          } catch(e) { return { href: getCurrentTarget() }; }
        }
        return src;
      });
      return _assign_orig(target, ...modifiedSources);
    };
  }
} catch(e) {}

// ========== Object.keys/values/entries on location ==========
try {
  var locationKeys = ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash', 'assign', 'replace', 'reload', 'toString'];
  // These should work via our property overrides
} catch(e) {}

// ========== Dynamic import() via Function ==========
// Can't easily override import(), but handle what we can

// ========== CSS insertRule/addRule ==========
try {
  if (CSSStyleSheet && CSSStyleSheet.prototype.insertRule) {
    var _insertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, index) {
      try {
        rule = rewriteCssUrls(rule);
      } catch(e) {}
      return _insertRule.call(this, rule, index);
    };
  }
  if (CSSStyleSheet && CSSStyleSheet.prototype.addRule) {
    var _addRule = CSSStyleSheet.prototype.addRule;
    CSSStyleSheet.prototype.addRule = function(selector, style, index) {
      try {
        style = rewriteCssUrls(style);
      } catch(e) {}
      return _addRule.call(this, selector, style, index);
    };
  }
} catch(e) {}

// ========== CSSStyleDeclaration.setProperty ==========
try {
  var _setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
    try {
      if (value && typeof value === 'string' && value.indexOf('url(') !== -1) {
        value = rewriteCssUrls(value);
      }
    } catch(e) {}
    return _setProperty.call(this, name, value, priority);
  };
} catch(e) {}

// ========== CSSStyleDeclaration property setters ==========
try {
  var cssUrlProps = ['background', 'backgroundImage', 'borderImage', 'borderImageSource',
                     'listStyle', 'listStyleImage', 'cursor', 'content',
                     'maskImage', 'mask', 'clipPath', 'filter', 'src'];
  cssUrlProps.forEach(function(prop) {
    try {
      var desc = _Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
      if (desc && desc.set) {
        var _set = desc.set;
        _Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
          set: function(v) {
            try {
              if (v && typeof v === 'string' && v.indexOf('url(') !== -1) {
                v = rewriteCssUrls(v);
              }
            } catch(e) {}
            _set.call(this, v);
          },
          get: desc.get,
          configurable: true
        });
      }
    } catch(e) {}
  });
} catch(e) {}

// ========== Constructable Stylesheets ==========
try {
  if (_window.CSSStyleSheet) {
    var _CSSStyleSheet = _window.CSSStyleSheet;
    // Replace/replaceSync for constructable stylesheets
    if (CSSStyleSheet.prototype.replace) {
      var _replace_css = CSSStyleSheet.prototype.replace;
      CSSStyleSheet.prototype.replace = function(text) {
        try { text = rewriteCssUrls(text); } catch(e) {}
        return _replace_css.call(this, text);
      };
    }
    if (CSSStyleSheet.prototype.replaceSync) {
      var _replaceSync = CSSStyleSheet.prototype.replaceSync;
      CSSStyleSheet.prototype.replaceSync = function(text) {
        try { text = rewriteCssUrls(text); } catch(e) {}
        return _replaceSync.call(this, text);
      };
    }
  }
} catch(e) {}

// ========== adoptedStyleSheets ==========
try {
  var adoptedDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'adoptedStyleSheets') || 
                    _Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'adoptedStyleSheets');
  // These use CSSStyleSheet objects which we've already patched
} catch(e) {}

// ========== Shadow DOM handling ==========
try {
  var _attachShadow = Element.prototype.attachShadow;
  if (_attachShadow) {
    Element.prototype.attachShadow = function(init) {
      var shadow = _attachShadow.call(this, init);
      // Observe the shadow root for changes
      try {
        var shadowObserver = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            if (mutation.type === 'childList') {
              mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                  processElementUrls(node);
                  if (node.querySelectorAll) {
                    var children = node.querySelectorAll('[src], [href], [action], [data], [poster], [style]');
                    children.forEach(processElementUrls);
                  }
                }
              });
            }
          });
        });
        shadowObserver.observe(shadow, { childList: true, subtree: true });
      } catch(e) {}
      return shadow;
    };
  }
} catch(e) {}

// ========== SVG animated href (SVGAnimatedString) ==========
try {
  if (_window.SVGAnimatedString) {
    var svgAnimDesc = _Object.getOwnPropertyDescriptor(SVGAnimatedString.prototype, 'baseVal');
    if (svgAnimDesc && svgAnimDesc.set) {
      var _setSvgAnim = svgAnimDesc.set;
      _Object.defineProperty(SVGAnimatedString.prototype, 'baseVal', {
        set: function(v) {
          try {
            if (v && !isSpecial(v) && !isProxied(v) && v.charAt(0) !== '#') {
              v = proxify(v);
            }
          } catch(e) {}
          _setSvgAnim.call(this, v);
        },
        get: svgAnimDesc.get,
        configurable: true
      });
    }
  }
} catch(e) {}

// ========== SVG Elements href attribute ==========
try {
  ['SVGAElement', 'SVGImageElement', 'SVGUseElement', 'SVGScriptElement', 
   'SVGFEImageElement', 'SVGMPathElement', 'SVGTextPathElement'].forEach(function(name) {
    try {
      var El = _window[name];
      if (!El || !El.prototype) return;
      // These have href as SVGAnimatedString - handled above
    } catch(e) {}
  });
} catch(e) {}

// ========== IntersectionObserver - trigger scan when elements become visible ==========
try {
  if (_window.IntersectionObserver) {
    var _IntersectionObserver = _window.IntersectionObserver;
    _window.IntersectionObserver = function(callback, options) {
      var wrappedCallback = function(entries, observer) {
        // After callback, scan for any lazy-loaded URLs
        _setTimeout(function() {
          entries.forEach(function(entry) {
            if (entry.isIntersecting && entry.target) {
              processElementUrls(entry.target);
            }
          });
        }, 50);
        return callback(entries, observer);
      };
      return new _IntersectionObserver(wrappedCallback, options);
    };
    _window.IntersectionObserver.prototype = _IntersectionObserver.prototype;
  }
} catch(e) {}

// ========== Handle data: URLs containing HTML in iframes/scripts ==========
// Some sites use data:text/html;base64,... or data:text/html,<html>...
// We can't easily rewrite inside data URLs, but we can at least handle the src
// The client-side scanning will catch most cases

// ========== Handle <base> tag changes ==========
// The <base> tag affects how relative URLs are resolved
// We need to intercept changes to it
try {
  var baseDesc = _Object.getOwnPropertyDescriptor(HTMLBaseElement.prototype, 'href');
  if (baseDesc && baseDesc.set) {
    var _setBase = baseDesc.set;
    var _getBase = baseDesc.get;
    _Object.defineProperty(HTMLBaseElement.prototype, 'href', {
      set: function(v) {
        // Don't actually change the base - we want URLs to resolve against proxy
        // Instead, store it for our resolution
        this.__originalBase__ = v;
        // Set it to the target origin so relative URLs work
        try {
          _setBase.call(this, getCurrentOrigin() + '/');
        } catch(e) {
          _setBase.call(this, v);
            }
          },
          get: function() {
        // Return what the page expects
        return this.__originalBase__ || _getBase.call(this);
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== Template content handling ==========
try {
  var templateContentDesc = _Object.getOwnPropertyDescriptor(HTMLTemplateElement.prototype, 'content');
  if (templateContentDesc && templateContentDesc.get) {
    var _getContent = templateContentDesc.get;
    _Object.defineProperty(HTMLTemplateElement.prototype, 'content', {
      get: function() {
        var content = _getContent.call(this);
        // Process URLs in template content when accessed
        try {
          if (content && content.querySelectorAll) {
            var elements = content.querySelectorAll('[src], [href], [action], [data], [poster]');
            elements.forEach(processElementUrls);
          }
        } catch(e) {}
        return content;
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== CSS text content ==========
function rewriteCssUrls(css) {
  if (!css || typeof css !== 'string') return css;
  try {
    var prefix = __PROXY_EMBEDDED__ ? '/?embedded=1&url=' : '/?url=';
    var base = getCurrentTarget();
    
    // Rewrite url()
    css = css.replace(/url\\(\\s*(['"]?)([^'"\\)]+)\\1\\s*\\)/gi, function(m, q, path) {
      try {
        if (!path || path.indexOf('data:') === 0 || path.indexOf('blob:') === 0 || path.indexOf('#') === 0) return m;
        if (isProxied(path)) return m;
        var abs = new _URL(path, base).href;
        return 'url("' + prefix + _encodeURIComponent(abs) + '")';
      } catch(e) {
        return m;
      }
    });
    
    // Rewrite @import "url"
    css = css.replace(/@import\\s+(['"])([^'"]+)\\1/gi, function(m, q, path) {
      try {
        if (!path || path.indexOf('data:') === 0) return m;
        if (isProxied(path)) return m;
        var abs = new _URL(path, base).href;
        return '@import "' + prefix + _encodeURIComponent(abs) + '"';
      } catch(e) {
        return m;
      }
    });
    
    // Rewrite @import url()
    css = css.replace(/@import\\s+url\\(\\s*(['"]?)([^'"\\)]+)\\1\\s*\\)/gi, function(m, q, path) {
      try {
        if (!path || path.indexOf('data:') === 0) return m;
        if (isProxied(path)) return m;
        var abs = new _URL(path, base).href;
        return '@import url("' + prefix + _encodeURIComponent(abs) + '")';
      } catch(e) {
        return m;
      }
    });
    
    // Rewrite @font-face src
    css = css.replace(/(@font-face\\s*\\{[^}]*src\\s*:\\s*)([^;}]+)/gi, function(m, pre, srcVal) {
      try {
        srcVal = srcVal.replace(/url\\(\\s*(['"]?)([^'"\\)]+)\\1\\s*\\)/gi, function(um, uq, upath) {
          if (!upath || upath.indexOf('data:') === 0 || upath.indexOf('blob:') === 0) return um;
          if (isProxied(upath)) return um;
          var abs = new _URL(upath, base).href;
          return 'url("' + prefix + _encodeURIComponent(abs) + '")';
        });
        return pre + srcVal;
      } catch(e) {
        return m;
      }
    });
  } catch(e) {}
  return css;
}

// ========== HTML Rewriting - COMPREHENSIVE ==========
function rewriteHtml(html) {
  if (!html || typeof html !== 'string') return html;
  try {
    // List of all URL attributes - use NON-CAPTURING groups (?:...) to avoid
    // misaligning the callback parameters in .replace()
    var urlAttrsPattern = '(?:src|href|action|data|poster|formaction|background|cite|longdesc|usemap|ping|manifest|icon|codebase)';
    var dataUrlAttrsPattern = '(?:data-src|data-href|data-url|data-background|data-poster|data-image|data-thumb|data-full|data-lazy|data-lazy-src|data-original|data-bg|data-video|data-audio|data-link|data-source|data-load)';
    
    // All URL attributes - 5 capture groups: pre, attrName, eqQuote, url, closeQuote
    var allUrlPattern = new RegExp('(<[^>]+\\\\s)(' + urlAttrsPattern + '|' + dataUrlAttrsPattern + ')(\\\\s*=\\\\s*["\\x27])([^"\\x27]+)(["\\x27])', 'gi');
    html = html.replace(allUrlPattern, function(m, pre, attrName, eqQuote, url, closeQuote) {
      if (isSpecial(url) || isProxied(url)) return m;
      return pre + attrName + eqQuote + proxify(url) + closeQuote;
    });
    
    // srcset attributes (complex - need special handling)
    html = html.replace(/(<[^>]+\\s)(srcset\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, pre, attr, srcset, q) {
      try {
        var newSrcset = srcset.split(/,\\s+/).map(function(s) {
          var parts = s.trim().split(/\\s+/);
          if (parts[0] && !isSpecial(parts[0]) && !isProxied(parts[0])) {
            parts[0] = proxify(parts[0]);
          }
          return parts.join(' ');
        }).join(', ');
        return pre + attr + newSrcset + q;
      } catch(e) {
        return m;
      }
    });
    
    // style url()
    html = html.replace(/(<[^>]+\\s)(style\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, pre, attr, style, q) {
      if (style.indexOf('url(') !== -1) {
        return pre + attr + rewriteCssUrls(style) + q;
      }
      return m;
    });
    
    // xlink:href for SVG
    html = html.replace(/(<[^>]+\\s)(xlink:href\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, pre, attr, url, q) {
      if (isSpecial(url) || isProxied(url)) return m;
      // Don't proxify fragment-only references
      if (url.charAt(0) === '#') return m;
      return pre + attr + proxify(url) + q;
    });
    
    // SVG href (without xlink)
    html = html.replace(/(<[^>]*\\sxmlns[^>]*\\s)(href\\s*=\\s*["'])([^"']+)(["'])/gi, function(m, pre, attr, url, q) {
      if (isSpecial(url) || isProxied(url)) return m;
      if (url.charAt(0) === '#') return m;
      return pre + attr + proxify(url) + q;
    });
    
    // <style> content
    html = html.replace(/(<style[^>]*>)([\\s\\S]*?)(<\\/style>)/gi, function(m, open, css, close) {
      return open + rewriteCssUrls(css) + close;
    });
    
    // Handle unquoted attributes (less common but possible)
    html = html.replace(/(<[^>]+\\s)(src|href|action)\\s*=\\s*([^\\s>"']+)/gi, function(m, pre, attr, url) {
      if (isSpecial(url) || isProxied(url)) return m;
      return pre + attr + '="' + proxify(url) + '"';
    });
    
  } catch(e) {}
  return html;
}

// ========== document.write ==========
try {
  var _docWrite = _document.write.bind(_document);
  var _docWriteln = _document.writeln.bind(_document);
  var _docOpen = _document.open.bind(_document);
  var _docClose = _document.close.bind(_document);
  
  _document.write = function() {
    var args = _Array.prototype.slice.call(arguments).map(function(a) { return rewriteHtml(safeStr(a)); });
    return _docWrite.apply(_document, args);
  };
  _document.writeln = function() {
    var args = _Array.prototype.slice.call(arguments).map(function(a) { return rewriteHtml(safeStr(a)); });
    return _docWriteln.apply(_document, args);
  };
  
  // document.open can take a URL parameter
  _document.open = function(url, name, features) {
    if (url && typeof url === 'string' && url.indexOf('text/html') !== 0 && url.indexOf('text/') !== 0) {
      // It's a URL, not a MIME type
      if (!isSpecial(url) && !isProxied(url)) {
        url = proxify(url);
      }
      return _docOpen(url, name, features);
    }
    return _docOpen(url, name, features);
  };
} catch(e) {}

// ========== innerHTML/outerHTML ==========
try {
  var innerDesc = _Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerDesc && innerDesc.set) {
    var _setInner = innerDesc.set;
    _Object.defineProperty(Element.prototype, 'innerHTML', {
      set: function(v) { _setInner.call(this, rewriteHtml(safeStr(v))); },
      get: innerDesc.get,
      configurable: true
    });
  }
} catch(e) {}

try {
  var outerDesc = _Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
  if (outerDesc && outerDesc.set) {
    var _setOuter = outerDesc.set;
    _Object.defineProperty(Element.prototype, 'outerHTML', {
      set: function(v) { _setOuter.call(this, rewriteHtml(safeStr(v))); },
      get: outerDesc.get,
      configurable: true
    });
  }
} catch(e) {}

// ========== insertAdjacentHTML ==========
try {
  var _insertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function(pos, html) {
    return _insertAdjacentHTML.call(this, pos, rewriteHtml(safeStr(html)));
  };
} catch(e) {}

// ========== DOMParser ==========
try {
  var _DOMParser = _window.DOMParser;
  _window.DOMParser = function() {
    var parser = new _DOMParser();
    var _parseFromString = parser.parseFromString.bind(parser);
    parser.parseFromString = function(str, type) {
      if (type && (type.indexOf('html') !== -1 || type.indexOf('xml') !== -1)) {
        str = rewriteHtml(safeStr(str));
      }
      return _parseFromString(str, type);
    };
    return parser;
  };
  _window.DOMParser.prototype = _DOMParser.prototype;
} catch(e) {}

// ========== Range.createContextualFragment ==========
try {
  var _createContextualFragment = Range.prototype.createContextualFragment;
  Range.prototype.createContextualFragment = function(html) {
    return _createContextualFragment.call(this, rewriteHtml(safeStr(html)));
  };
} catch(e) {}

// ========== document.createElement override for script/link/img ==========
try {
  var _createElement = _document.createElement.bind(_document);
  _document.createElement = function(tagName, options) {
    var el = _createElement(tagName, options);
    // Elements are already handled by property overrides
      return el;
    };
} catch(e) {}

// ========== document.createElementNS for SVG/MathML ==========
try {
  var _createElementNS = _document.createElementNS.bind(_document);
  _document.createElementNS = function(ns, tagName, options) {
    var el = _createElementNS(ns, tagName, options);
    // Elements are handled by property overrides
    return el;
  };
} catch(e) {}

// ========== cloneNode - ensure cloned elements have proxied URLs ==========
try {
  var _cloneNode = Node.prototype.cloneNode;
  Node.prototype.cloneNode = function(deep) {
    var clone = _cloneNode.call(this, deep);
    // Process cloned element URLs
    try {
      if (clone.nodeType === 1) {
        processElementUrls(clone);
        if (deep && clone.querySelectorAll) {
          var children = clone.querySelectorAll('[src], [href], [action], [data], [poster], [srcset]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return clone;
  };
} catch(e) {}

// ========== importNode ==========
try {
  var _importNode = _document.importNode.bind(_document);
  _document.importNode = function(node, deep) {
    var imported = _importNode(node, deep);
    try {
      if (imported.nodeType === 1) {
        processElementUrls(imported);
        if (deep && imported.querySelectorAll) {
          var children = imported.querySelectorAll('[src], [href], [action], [data], [poster], [srcset]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return imported;
  };
} catch(e) {}

// ========== adoptNode ==========
try {
  var _adoptNode = _document.adoptNode.bind(_document);
  _document.adoptNode = function(node) {
    var adopted = _adoptNode(node);
    try {
      if (adopted && adopted.nodeType === 1) {
        processElementUrls(adopted);
        if (adopted.querySelectorAll) {
          var children = adopted.querySelectorAll('[src], [href], [action], [data], [poster], [srcset]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return adopted;
  };
} catch(e) {}

// ========== Helper to process element URLs ==========
function processElementUrls(el) {
  if (!el || el.nodeType !== 1) return;
  try {
    ['src', 'href', 'action', 'data', 'poster', 'formaction'].forEach(function(attr) {
      if (el.hasAttribute && el.hasAttribute(attr)) {
        var val = el.getAttribute(attr);
        if (val && !isSpecial(val) && !isProxied(val)) {
          _setAttribute.call(el, attr, proxify(val));
          }
        }
      });
    // Handle srcset
    if (el.hasAttribute && el.hasAttribute('srcset')) {
      var srcset = el.getAttribute('srcset');
      if (srcset && !isProxied(srcset)) {
        var newSrcset = srcset.split(/,\\s+/).map(function(s) {
          var parts = s.trim().split(/\\s+/);
          if (parts[0] && !isSpecial(parts[0]) && !isProxied(parts[0])) {
            parts[0] = proxify(parts[0]);
          }
          return parts.join(' ');
        }).join(', ');
        _setAttribute.call(el, 'srcset', newSrcset);
      }
    }
    // Handle style attribute with url()
    if (el.hasAttribute && el.hasAttribute('style')) {
      var style = el.getAttribute('style');
      if (style && style.indexOf('url(') !== -1) {
        _setAttribute.call(el, 'style', rewriteCssUrls(style));
      }
    }
  } catch(e) {}
}

// ========== appendChild/insertBefore/replaceChild ==========
try {
  var _appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function(child) {
    try {
      if (child && child.nodeType === 1) {
        processElementUrls(child);
        if (child.querySelectorAll) {
          var children = child.querySelectorAll('[src], [href], [action], [data], [poster], [srcset], [style]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return _appendChild.call(this, child);
  };
} catch(e) {}

try {
  var _insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function(newNode, refNode) {
    try {
      if (newNode && newNode.nodeType === 1) {
        processElementUrls(newNode);
        if (newNode.querySelectorAll) {
          var children = newNode.querySelectorAll('[src], [href], [action], [data], [poster], [srcset], [style]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return _insertBefore.call(this, newNode, refNode);
  };
} catch(e) {}

try {
  var _replaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function(newChild, oldChild) {
    try {
      if (newChild && newChild.nodeType === 1) {
        processElementUrls(newChild);
        if (newChild.querySelectorAll) {
          var children = newChild.querySelectorAll('[src], [href], [action], [data], [poster], [srcset], [style]');
          children.forEach(processElementUrls);
        }
      }
    } catch(e) {}
    return _replaceChild.call(this, newChild, oldChild);
  };
} catch(e) {}

// ========== Element.append/prepend/before/after/replaceWith ==========
['append', 'prepend', 'before', 'after', 'replaceWith'].forEach(function(method) {
  try {
    var orig = Element.prototype[method];
    if (orig) {
      Element.prototype[method] = function() {
        var args = _Array.prototype.slice.call(arguments);
        args.forEach(function(arg) {
          if (arg && arg.nodeType === 1) {
            processElementUrls(arg);
            if (arg.querySelectorAll) {
              var children = arg.querySelectorAll('[src], [href], [action], [data], [poster], [srcset], [style]');
              children.forEach(processElementUrls);
            }
          }
        });
        return orig.apply(this, args);
      };
    }
  } catch(e) {}
});

// ========== ParentNode.replaceChildren ==========
try {
  if (Element.prototype.replaceChildren) {
    var _replaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function() {
      var args = _Array.prototype.slice.call(arguments);
      args.forEach(function(arg) {
        if (arg && arg.nodeType === 1) {
          processElementUrls(arg);
          if (arg.querySelectorAll) {
            var children = arg.querySelectorAll('[src], [href], [action], [data], [poster], [srcset], [style]');
            children.forEach(processElementUrls);
          }
        }
      });
      return _replaceChildren.apply(this, args);
    };
  }
} catch(e) {}

// ========== MutationObserver for dynamic content - COMPREHENSIVE ==========
try {
  var urlAttrs = ['src', 'href', 'action', 'data', 'poster', 'formaction', 'background',
                  'cite', 'longdesc', 'usemap', 'ping', 'manifest', 'icon', 'codebase'];
  var dataUrlAttrs = ['data-src', 'data-href', 'data-url', 'data-background', 'data-poster',
                      'data-image', 'data-thumb', 'data-full', 'data-lazy', 'data-lazy-src',
                      'data-original', 'data-bg', 'data-video', 'data-audio', 'data-link',
                      'data-source', 'data-load'];
  var allUrlAttrs = urlAttrs.concat(dataUrlAttrs).concat(['srcset', 'style', 'xlink:href']);
  
  var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
      if (mutation.type === 'attributes') {
        var attr = mutation.attributeName;
        var el = mutation.target;
        
        // Handle URL attributes
        if (urlAttrs.indexOf(attr) !== -1 || dataUrlAttrs.indexOf(attr) !== -1) {
          var val = el.getAttribute(attr);
          if (val && !isSpecial(val) && !isProxied(val)) {
            try {
              _setAttribute.call(el, attr, proxify(val));
            } catch(e) {}
          }
        }
        // Handle srcset
        else if (attr === 'srcset') {
          var srcset = el.getAttribute('srcset');
          if (srcset && !isProxied(srcset)) {
            try {
              var newSrcset = srcset.split(/,\\s+/).map(function(s) {
                var parts = s.trim().split(/\\s+/);
                if (parts[0] && !isSpecial(parts[0]) && !isProxied(parts[0])) {
                  parts[0] = proxify(parts[0]);
                }
                return parts.join(' ');
              }).join(', ');
              _setAttribute.call(el, 'srcset', newSrcset);
            } catch(e) {}
          }
        }
        // Handle style with url()
        else if (attr === 'style') {
          var style = el.getAttribute('style');
          if (style && style.indexOf('url(') !== -1 && !isProxied(style)) {
            try {
              _setAttribute.call(el, 'style', rewriteCssUrls(style));
            } catch(e) {}
          }
        }
        // Handle xlink:href
        else if (attr === 'xlink:href' || attr === 'href') {
          var val = el.getAttribute(attr) || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (val && !isSpecial(val) && !isProxied(val)) {
            try {
              _setAttribute.call(el, attr, proxify(val));
            } catch(e) {}
          }
        }
      } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) {
            processElementUrls(node);
            // Process all descendants
            if (node.querySelectorAll) {
              try {
                var selector = allUrlAttrs.map(function(a) { return '[' + a + ']'; }).join(', ');
                var children = node.querySelectorAll(selector);
                children.forEach(processElementUrls);
              } catch(e) {}
            }
            // Handle style elements
            if (node.tagName === 'STYLE') {
              try {
                var css = node.textContent;
                if (css && css.indexOf('url(') !== -1 && !isProxied(css)) {
                  node.textContent = rewriteCssUrls(css);
                }
              } catch(e) {}
            }
            // Handle script elements with src
            if (node.tagName === 'SCRIPT' && node.src) {
              // Already handled by property override
            }
            }
          });
        }
      });
    });
  
  function startObserver() {
    try {
      observer.observe(_document.documentElement || _document.body || _document, {
        attributes: true,
        attributeFilter: allUrlAttrs,
      childList: true,
      subtree: true
    });
    } catch(e) {}
  }
  
  if (_document.readyState === 'loading') {
    _window.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
} catch(e) {}

// ========== Click Handler ==========
try {
  _document.addEventListener('click', function(e) {
    try {
      var t = e.target;
      while (t && t.tagName !== 'A') t = t.parentElement;
      if (t && t.tagName === 'A') {
        var href = t.getAttribute('href');
        if (!href || isSpecial(href)) return;
        
        var target = t.getAttribute('target') || t.getAttribute('data-proxy-target');
        if (target === '_blank' || target === '_new') {
          e.preventDefault();
          e.stopPropagation();
          var resolved = resolveUrl(href);
          if (__PROXY_EMBEDDED__) {
            try {
              var realParent = _Object.getPrototypeOf(_window).parent;
              if (realParent && realParent !== _window) {
                realParent.postMessage({ type: 'PROXY_NEW_TAB', url: resolved }, '*');
                return;
              }
            } catch(ex) {}
          }
          _window.open(proxify(href), '_blank');
        }
      }
    } catch(ex) {}
    }, true);
} catch(e) {}

// ========== Form Submit ==========
try {
  _document.addEventListener('submit', function(e) {
    try {
      var form = e.target;
      if (form && form.tagName === 'FORM') {
        var action = form.getAttribute('action');
        if (!action || (!isProxied(action) && !isSpecial(action))) {
          _setAttribute.call(form, 'action', proxify(action || getCurrentTarget()));
        }
      }
    } catch(ex) {}
  }, true);
} catch(e) {}

// ========== postMessage wrapper for targetOrigin ==========
try {
  var _postMessage = _window.postMessage.bind(_window);
  _window.postMessage = function(message, targetOrigin, transfer) {
    // Allow all origins since we're proxying
    if (targetOrigin && targetOrigin !== '*') {
      targetOrigin = '*';
    }
    return _postMessage(message, targetOrigin, transfer);
  };
} catch(e) {}

// ========== Parent Notification ==========
function notifyParent() {
  if (!__PROXY_EMBEDDED__ || !_realParent) return;
  try {
    _realParent.postMessage({
      type: 'PROXY_URL_CHANGED',
      url: getCurrentTarget(),
      title: _document.title,
      proxyUrl: _realLocationHref
              }, '*');
  } catch(e) {}
}

try {
  if (_document.readyState === 'complete' || _document.readyState === 'interactive') {
    _setTimeout(notifyParent, 0);
  } else {
    _window.addEventListener('DOMContentLoaded', notifyParent);
  }
  _window.addEventListener('load', function() {
    notifyParent();
    // Extra scan after load for late-loading content
    _setTimeout(function() { if (typeof scanAndProxify === 'function') scanAndProxify(); }, 200);
  });
  _window.addEventListener('popstate', function() {
    // Update _currentTarget from the new URL after popstate
    try {
      var realSearch = _location.search;
      try {
        var protoLoc = _Object.getOwnPropertyDescriptor(_Object.getPrototypeOf(_window), 'location');
        if (protoLoc && protoLoc.get) {
          var rl = protoLoc.get.call(_window);
          realSearch = rl.search;
        }
      } catch(e) {}
      
      // Check if the URL has ?url= parameter
      if (realSearch && realSearch.indexOf('url=') !== -1) {
        var params = new URLSearchParams(realSearch);
        var urlParam = params.get('url');
        if (urlParam) {
          _currentTarget = urlParam.indexOf('%') !== -1 ? _decodeURIComponent(urlParam) : urlParam;
        }
      } else {
        // URL is in target path format (after replaceState)
        // Reconstruct target from origin + current path
        var realPath = _location.pathname;
        var realSearchStr = _location.search;
        var realHash = _location.hash;
        try {
          var protoLoc2 = _Object.getOwnPropertyDescriptor(_Object.getPrototypeOf(_window), 'location');
          if (protoLoc2 && protoLoc2.get) {
            var rl2 = protoLoc2.get.call(_window);
            realPath = rl2.pathname;
            realSearchStr = rl2.search;
            realHash = rl2.hash;
          }
        } catch(e) {}
        _currentTarget = __PROXY_ORIGIN__ + realPath + realSearchStr + realHash;
      }
    } catch(e) {}
    
    notifyParent();
    _setTimeout(function() { if (typeof scanAndProxify === 'function') scanAndProxify(); }, 100);
  });
  _window.addEventListener('hashchange', function(e) {
    notifyParent();
    // Try to update hashchange event properties
    try {
      if (e && _Object.defineProperty) {
        _Object.defineProperty(e, 'newURL', { get: function() { return getCurrentTarget(); } });
      }
    } catch(ex) {}
  });
  _window.addEventListener('beforeunload', function() {
    notifyParent();
  });
  
  // Title observer
  var titleObs = new MutationObserver(function() {
    _setTimeout(notifyParent, 10);
  });
  var observeTitle = function() {
    var t = _document.querySelector('title');
    if (t) {
      titleObs.observe(t, { subtree: true, characterData: true, childList: true });
    } else {
      // No title yet, observe head for when it's added
      var head = _document.head || _document.querySelector('head');
      if (head) {
        var headObs = new MutationObserver(function(muts, obs) {
          var t = _document.querySelector('title');
          if (t) {
            obs.disconnect();
            titleObs.observe(t, { subtree: true, characterData: true, childList: true });
            notifyParent();
          }
        });
        headObs.observe(head, { childList: true });
      }
    }
  };
  if (_document.readyState === 'loading') {
    _window.addEventListener('DOMContentLoaded', observeTitle);
  } else {
    observeTitle();
  }
} catch(e) {}

// ========== Message Handler ==========
try {
  _window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'PROXY_GET_URL') {
      try {
        e.source.postMessage({ 
          type: 'PROXY_URL_RESPONSE', 
          url: getCurrentTarget(), 
          title: _document.title 
      }, '*');
      } catch(ex) {}
    }
  });
} catch(e) {}

// ========== Console override (for debugging) ==========
try {
  _window.__PROXY_DEBUG__ = function() {
    return {
      target: getCurrentTarget(),
      origin: getCurrentOrigin(),
      host: getCurrentHost(),
      embedded: __PROXY_EMBEDDED__
    };
  };
} catch(e) {}

// ========== URL.createObjectURL / revokeObjectURL ==========
try {
  var _createObjectURL = _URL.createObjectURL ? _URL.createObjectURL.bind(_URL) : null;
  var _revokeObjectURL = _URL.revokeObjectURL ? _URL.revokeObjectURL.bind(_URL) : null;
  var _blobUrls = new Map();
  
  if (_createObjectURL) {
    _URL.createObjectURL = function(blob) {
      var url = _createObjectURL(blob);
      _blobUrls.set(url, true);
      return url;
    };
  }
  if (_revokeObjectURL) {
    _URL.revokeObjectURL = function(url) {
      _blobUrls.delete(url);
      return _revokeObjectURL(url);
    };
  }
  
  // Helper to check if URL is a blob URL we created
  _window.__isOurBlobUrl__ = function(url) {
    return _blobUrls.has(url);
  };
} catch(e) {}

// ========== Storage namespace per target domain ==========
try {
  var _storagePrefix = '__proxy_' + getCurrentHost().replace(/[^a-zA-Z0-9]/g, '_') + '_';
  
  // Wrap localStorage
  var _localStorage = _window.localStorage;
  var _localStorageProxy = {
    getItem: function(key) { return _localStorage.getItem(_storagePrefix + key); },
    setItem: function(key, val) { return _localStorage.setItem(_storagePrefix + key, val); },
    removeItem: function(key) { return _localStorage.removeItem(_storagePrefix + key); },
    clear: function() {
      var toRemove = [];
      for (var i = 0; i < _localStorage.length; i++) {
        var k = _localStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) toRemove.push(k);
      }
      toRemove.forEach(function(k) { _localStorage.removeItem(k); });
    },
    get length() {
      var count = 0;
      for (var i = 0; i < _localStorage.length; i++) {
        var k = _localStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) count++;
      }
      return count;
    },
    key: function(n) {
      var count = 0;
      for (var i = 0; i < _localStorage.length; i++) {
        var k = _localStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) {
          if (count === n) return k.substring(_storagePrefix.length);
          count++;
        }
      }
      return null;
    }
  };
  
  try {
    _Object.defineProperty(_window, 'localStorage', {
      get: function() { return _localStorageProxy; },
      configurable: true
    });
  } catch(e) {}
  
  // Wrap sessionStorage similarly
  var _sessionStorage = _window.sessionStorage;
  var _sessionStorageProxy = {
    getItem: function(key) { return _sessionStorage.getItem(_storagePrefix + key); },
    setItem: function(key, val) { return _sessionStorage.setItem(_storagePrefix + key, val); },
    removeItem: function(key) { return _sessionStorage.removeItem(_storagePrefix + key); },
    clear: function() {
      var toRemove = [];
      for (var i = 0; i < _sessionStorage.length; i++) {
        var k = _sessionStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) toRemove.push(k);
      }
      toRemove.forEach(function(k) { _sessionStorage.removeItem(k); });
    },
    get length() {
      var count = 0;
      for (var i = 0; i < _sessionStorage.length; i++) {
        var k = _sessionStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) count++;
      }
      return count;
    },
    key: function(n) {
      var count = 0;
      for (var i = 0; i < _sessionStorage.length; i++) {
        var k = _sessionStorage.key(i);
        if (k && k.indexOf(_storagePrefix) === 0) {
          if (count === n) return k.substring(_storagePrefix.length);
          count++;
        }
      }
      return null;
    }
  };
  
  try {
    _Object.defineProperty(_window, 'sessionStorage', {
      get: function() { return _sessionStorageProxy; },
      configurable: true
    });
  } catch(e) {}
} catch(e) {}

// ========== postMessage event.origin spoofing ==========
try {
  var _addEventListener = _window.addEventListener.bind(_window);
  _window.addEventListener = function(type, listener, options) {
    if (type === 'message') {
      var wrappedListener = function(e) {
        // Create a proxy event with spoofed origin
        try {
          var spoofedEvent = new _Proxy(e, {
            get: function(target, prop) {
              if (prop === 'origin') {
                return getCurrentOrigin();
              }
              var val = target[prop];
              return typeof val === 'function' ? val.bind(target) : val;
            }
          });
          return listener.call(this, spoofedEvent);
        } catch(ex) {
          return listener.call(this, e);
        }
      };
      return _addEventListener(type, wrappedListener, options);
    }
    return _addEventListener(type, listener, options);
  };
} catch(e) {}

// ========== Anchor ping attribute (tracking) ==========
try {
  var pingDesc = _Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'ping');
  if (pingDesc && pingDesc.set) {
    var _setPing = pingDesc.set;
    _Object.defineProperty(HTMLAnchorElement.prototype, 'ping', {
      set: function(v) {
        try {
          if (v && typeof v === 'string') {
            v = v.split(/\\s+/).map(function(url) {
              if (url && !isSpecial(url) && !isProxied(url)) {
                return proxify(url);
              }
              return url;
            }).join(' ');
          }
        } catch(e) {}
        _setPing.call(this, v);
      },
      get: pingDesc.get,
      configurable: true
    });
  }
} catch(e) {}

// ========== More data-* attributes for lazy loading ==========
try {
  var lazyAttrs = ['data-src', 'data-href', 'data-url', 'data-background', 'data-poster',
                   'data-original', 'data-lazy', 'data-lazy-src', 'data-srcset',
                   'data-bg', 'data-image', 'data-thumb', 'data-full'];
  
  lazyAttrs.forEach(function(attr) {
    try {
      var origSet = Element.prototype.setAttribute;
      // Already overridden above, but let's also watch via MutationObserver
    } catch(e) {}
  });
} catch(e) {}

// ========== Shadow DOM support ==========
// (Already handled above in the Shadow DOM handling section)

// ========== Template element content ==========
try {
  var templateContentDesc = _Object.getOwnPropertyDescriptor(HTMLTemplateElement.prototype, 'content');
  // Templates are inert - they get processed when cloned/inserted
  // The MutationObserver will catch them when inserted
} catch(e) {}

// ========== Performance API - hide proxy URLs ==========
try {
  if (_window.performance && _window.performance.getEntries) {
    var _getEntries = _window.performance.getEntries.bind(_window.performance);
    _window.performance.getEntries = function() {
      var entries = _getEntries();
      return entries.map(function(e) {
        // Don't expose proxy URLs
        if (e.name && e.name.indexOf('/?url=') !== -1) {
          try {
            var urlMatch = e.name.match(/[?&]url=([^&]+)/);
            if (urlMatch) {
              var decoded = _decodeURIComponent(urlMatch[1]);
              return _Object.assign({}, e, { name: decoded });
            }
          } catch(ex) {}
        }
        return e;
      });
    };
    
    var _getEntriesByName = _window.performance.getEntriesByName.bind(_window.performance);
    _window.performance.getEntriesByName = function(name, type) {
      // If they're looking for an original URL, search for proxied version
      if (name && !isProxied(name)) {
        var proxied = proxify(name);
        var results = _getEntriesByName(proxied, type);
        if (results.length > 0) return results;
      }
      return _getEntriesByName(name, type);
    };
  }
} catch(e) {}

// ========== Cookie handling - rewrite domain/path ==========
try {
  var cookieDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookieDesc) {
    var _getCookie = cookieDesc.get;
    var _setCookie = cookieDesc.set;
    
    _Object.defineProperty(_document, 'cookie', {
      get: function() {
        return _getCookie.call(_document);
      },
      set: function(val) {
        // Remove domain and path restrictions so cookies work
        try {
          val = val.replace(/;\\s*domain=[^;]*/gi, '')
                   .replace(/;\\s*path=[^;]*/gi, '; path=/');
        } catch(e) {}
        return _setCookie.call(_document, val);
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== Node.baseURI for all nodes ==========
try {
  var nodeBaseURIDesc = _Object.getOwnPropertyDescriptor(Node.prototype, 'baseURI');
  if (nodeBaseURIDesc && nodeBaseURIDesc.get) {
    _Object.defineProperty(Node.prototype, 'baseURI', {
      get: function() { return getCurrentTarget(); },
      configurable: true
    });
  }
} catch(e) {}

// ========== contentDocument / contentWindow for iframes ==========
// Try to inject our proxy script into same-origin iframes
try {
  var contentDocDesc = _Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
  var contentWinDesc = _Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  
  if (contentDocDesc && contentDocDesc.get) {
    var _getContentDoc = contentDocDesc.get;
    _Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
      get: function() {
        var doc = _getContentDoc.call(this);
        if (doc) {
          try {
            // Try to inject our overrides into the iframe
            injectIntoFrame(doc.defaultView);
          } catch(e) {
            // Cross-origin - can't access
          }
        }
        return doc;
      },
      configurable: true
    });
  }
  
  if (contentWinDesc && contentWinDesc.get) {
    var _getContentWin = contentWinDesc.get;
    _Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function() {
        var win = _getContentWin.call(this);
        if (win) {
          try {
            injectIntoFrame(win);
          } catch(e) {
            // Cross-origin - can't access
          }
        }
        return win;
      },
      configurable: true
    });
  }
  
  // Function to inject minimal proxy overrides into iframe windows
  function injectIntoFrame(frameWindow) {
    if (!frameWindow || frameWindow.__proxyInjected__) return;
    try {
      frameWindow.__proxyInjected__ = true;
      
      // Share our proxify function
      frameWindow.__proxyProxify__ = proxify;
      frameWindow.__proxyResolve__ = resolveUrl;
      frameWindow.__proxyGetTarget__ = getCurrentTarget;
      
      // Override location.href setter in iframe
      try {
        var frameLoc = frameWindow.location;
        var frameAssign = frameLoc.assign ? frameLoc.assign.bind(frameLoc) : function(u) { frameLoc.href = u; };
        frameLoc.assign = function(u) { 
          try { u = proxify(u); } catch(e) {}
          return frameAssign(u);
        };
        frameLoc.replace = function(u) {
          try { u = proxify(u); } catch(e) {}
          return frameAssign(u);
        };
      } catch(e) {}
      
      // Override fetch in iframe
      try {
        var frameFetch = frameWindow.fetch;
        if (frameFetch) {
          frameWindow.fetch = function(input, init) {
            try {
              if (typeof input === 'string' && !isSpecial(input) && !isProxied(input)) {
                input = proxify(input);
              }
            } catch(e) {}
            return frameFetch.call(frameWindow, input, init);
          };
        }
      } catch(e) {}
      
    } catch(e) {}
  }
  
  // Also monitor iframe load events
  _document.addEventListener('load', function(e) {
    if (e.target && e.target.tagName === 'IFRAME') {
      try {
        injectIntoFrame(e.target.contentWindow);
      } catch(ex) {}
    }
  }, true);
  
} catch(e) {}

// ========== window.opener ==========
try {
  _Object.defineProperty(_window, 'opener', {
    get: function() { return null; },
    set: function() {},
    configurable: true
  });
} catch(e) {}

// ========== eval and Function - wrap for safety ==========
try {
  var _eval = _window.eval;
  // Don't override eval - it could break too many things
} catch(e) {}

// ========== setTimeout/setInterval with string (code execution) ==========
try {
  // These could contain URLs in string form but overriding is risky
  // The HTML rewriting and property overrides should catch most cases
} catch(e) {}

// ========== Request/Response constructors ==========
try {
  var _Request = _window.Request;
  _window.Request = function(input, init) {
    try {
      if (typeof input === 'string' && !isSpecial(input) && !isProxied(input)) {
        input = proxify(input);
      }
    } catch(e) {}
    return new _Request(input, init);
  };
  _window.Request.prototype = _Request.prototype;
} catch(e) {}

// ========== FormData - handle file uploads ==========
try {
  // FormData works fine, but form action needs to be proxied
  // Already handled by form action override
} catch(e) {}

// ========== Clipboard API ==========
try {
  if (navigator && navigator.clipboard) {
    var _writeText = navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
    var _write = navigator.clipboard.write ? navigator.clipboard.write.bind(navigator.clipboard) : null;
    var _readText = navigator.clipboard.readText ? navigator.clipboard.readText.bind(navigator.clipboard) : null;
    var _read = navigator.clipboard.read ? navigator.clipboard.read.bind(navigator.clipboard) : null;
    // Clipboard works fine, no URL rewriting needed for clipboard
  }
} catch(e) {}

// ========== Drag and Drop - dataTransfer URLs ==========
try {
  _document.addEventListener('drop', function(e) {
    try {
      if (e.dataTransfer) {
        var url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && (url.indexOf('http://') === 0 || url.indexOf('https://') === 0)) {
          // Could proxify dropped URLs but might be confusing
        }
      }
    } catch(ex) {}
  }, true);
} catch(e) {}

// ========== Beacon/Ping/CSP Report URLs - block leaking ==========
try {
  // CSP reports are already blocked by removing CSP headers
  // Beacon is already proxified
} catch(e) {}

// ========== Link prefetch/preload/preconnect ==========
try {
  // These are already rewritten by LinkRewriter
  // But let's also handle dynamically created ones
  var linkRelDesc = _Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'rel');
  // Let these work normally - href is already proxified
} catch(e) {}

// ========== base.href should return target URL ==========
try {
  // Base elements are removed by BaseRewriter
} catch(e) {}

// ========== Trusted Types (if supported) ==========
try {
  if (_window.trustedTypes && _window.trustedTypes.createPolicy) {
    // Create a default policy that rewrites URLs
    try {
      _window.trustedTypes.createPolicy('default', {
        createHTML: function(s) { return rewriteHtml(s); },
        createScript: function(s) { return s; },
        createScriptURL: function(s) { 
          if (!isSpecial(s) && !isProxied(s)) return proxify(s);
          return s;
        }
      });
    } catch(e) {}
  }
} catch(e) {}

// ========== Event.target.href/src handling ==========
// Scripts might access e.target.href or similar - ensure elements have proxied URLs
try {
  var eventTypes = ['click', 'mousedown', 'mouseup', 'contextmenu', 'dblclick', 'auxclick'];
  eventTypes.forEach(function(type) {
    _document.addEventListener(type, function(e) {
      try {
        if (e.target && e.target.nodeType === 1) {
          processElementUrls(e.target);
        }
      } catch(ex) {}
    }, { capture: true, passive: true });
  });
} catch(e) {}

// ========== URL concatenation/string coercion ==========
// Handled by the location Proxy's get trap for Symbol.toPrimitive and toString.
// Belt-and-suspenders: also try to set on real _location
try {
  if (typeof Symbol !== 'undefined' && Symbol.for) {
    try {
      _Object.defineProperty(_location, Symbol.for('nodejs.util.inspect.custom'), {
        value: function() { return getCurrentTarget(); },
        configurable: true
      });
    } catch(e) {}
  }
} catch(e) {}

// ========== document.forms action check ==========
try {
  var formsDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'forms');
  if (formsDesc && formsDesc.get) {
    var _getForms = formsDesc.get;
    _Object.defineProperty(_document, 'forms', {
      get: function() {
        var forms = _getForms.call(_document);
        // Ensure all form actions are proxified
        try {
          for (var i = 0; i < forms.length; i++) {
            var form = forms[i];
            var action = form.getAttribute('action');
            if (action && !isProxied(action) && !isSpecial(action)) {
              _setAttribute.call(form, 'action', proxify(action));
            }
          }
        } catch(ex) {}
        return forms;
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== document.links href check ==========
try {
  var linksDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'links');
  if (linksDesc && linksDesc.get) {
    var _getLinks = linksDesc.get;
    _Object.defineProperty(_document, 'links', {
      get: function() {
        var links = _getLinks.call(_document);
        // Ensure all link hrefs are proxified
        try {
          for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var href = link.getAttribute('href');
            if (href && !isProxied(href) && !isSpecial(href)) {
              _setAttribute.call(link, 'href', proxify(href));
            }
          }
        } catch(ex) {}
        return links;
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== document.images src check ==========
try {
  var imagesDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'images');
  if (imagesDesc && imagesDesc.get) {
    var _getImages = imagesDesc.get;
    _Object.defineProperty(_document, 'images', {
      get: function() {
        var images = _getImages.call(_document);
        try {
          for (var i = 0; i < images.length; i++) {
            var img = images[i];
            var src = img.getAttribute('src');
            if (src && !isProxied(src) && !isSpecial(src)) {
              _setAttribute.call(img, 'src', proxify(src));
            }
          }
        } catch(ex) {}
        return images;
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== document.scripts src check ==========
try {
  var scriptsDesc = _Object.getOwnPropertyDescriptor(Document.prototype, 'scripts');
  if (scriptsDesc && scriptsDesc.get) {
    var _getScripts = scriptsDesc.get;
    _Object.defineProperty(_document, 'scripts', {
      get: function() {
        var scripts = _getScripts.call(_document);
        try {
          for (var i = 0; i < scripts.length; i++) {
            var script = scripts[i];
            var src = script.getAttribute('src');
            if (src && !isProxied(src) && !isSpecial(src)) {
              _setAttribute.call(script, 'src', proxify(src));
            }
          }
        } catch(ex) {}
        return scripts;
      },
      configurable: true
    });
  }
} catch(e) {}

// ========== Canvas toDataURL / toBlob - allow but track ==========
try {
  // Canvas data URLs are fine - they're data: URLs
} catch(e) {}

// ========== Geolocation - let it work ==========
try {
  // Geolocation works fine through proxy
} catch(e) {}

// ========== Notifications ==========
try {
  // Notifications might show proxy URLs - but hard to fix
} catch(e) {}

// ========== Final cleanup - scan entire document ==========
try {
  var allUrlAttrsForScan = ['src', 'href', 'action', 'data', 'poster', 'formaction', 'background',
                            'cite', 'longdesc', 'usemap', 'ping', 'manifest', 'icon', 'codebase',
                            'data-src', 'data-href', 'data-url', 'data-background', 'data-poster',
                            'data-image', 'data-thumb', 'data-full', 'data-lazy', 'data-lazy-src',
                            'data-original', 'data-bg', 'data-video', 'data-audio', 'data-link',
                            'data-source', 'data-load'];
  
  function scanAndProxify() {
    try {
      // Build selector for all URL attributes
      var selector = allUrlAttrsForScan.map(function(a) { return '[' + a + ']'; }).join(', ');
      selector += ', [srcset], [style*="url("], [xlink\\\\:href]';
      
      var allElements = _document.querySelectorAll(selector);
      allElements.forEach(function(el) {
        // Process regular URL attributes
        allUrlAttrsForScan.forEach(function(attr) {
          if (el.hasAttribute(attr)) {
            var val = el.getAttribute(attr);
            if (val && !isSpecial(val) && !isProxied(val)) {
              try { _setAttribute.call(el, attr, proxify(val)); } catch(e) {}
            }
          }
        });
        
        // Handle srcset
        if (el.hasAttribute('srcset')) {
          var srcset = el.getAttribute('srcset');
          if (srcset && !isProxied(srcset)) {
            try {
              var newSrcset = srcset.split(/,\\s+/).map(function(s) {
                var parts = s.trim().split(/\\s+/);
                if (parts[0] && !isSpecial(parts[0]) && !isProxied(parts[0])) {
                  parts[0] = proxify(parts[0]);
                }
                return parts.join(' ');
              }).join(', ');
              _setAttribute.call(el, 'srcset', newSrcset);
            } catch(e) {}
          }
        }
        
        // Handle style with url()
        if (el.hasAttribute('style')) {
          var style = el.getAttribute('style');
          if (style && style.indexOf('url(') !== -1 && !isProxied(style)) {
            try { _setAttribute.call(el, 'style', rewriteCssUrls(style)); } catch(e) {}
          }
        }
        
        // Handle xlink:href (SVG)
        var xlinkHref = el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xlinkHref && !isSpecial(xlinkHref) && !isProxied(xlinkHref)) {
          try { el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', proxify(xlinkHref)); } catch(e) {}
        }
      });
      
      // Scan style elements
      var styles = _document.querySelectorAll('style');
      styles.forEach(function(style) {
        var css = style.textContent;
        if (css && css.indexOf('url(') !== -1 && !isProxied(css)) {
          try { style.textContent = rewriteCssUrls(css); } catch(e) {}
        }
      });
      
      // Scan inline styles on all elements
      var styledElements = _document.querySelectorAll('[style]');
      styledElements.forEach(function(el) {
        var style = el.getAttribute('style');
        if (style && style.indexOf('url(') !== -1 && !isProxied(style)) {
          try { _setAttribute.call(el, 'style', rewriteCssUrls(style)); } catch(e) {}
        }
      });
      
      // Scan iframes and try to access their content
      var iframes = _document.querySelectorAll('iframe');
      iframes.forEach(function(iframe) {
        try {
          if (iframe.contentDocument) {
            // Same-origin iframe - scan its content too
            var iframeDoc = iframe.contentDocument;
            var iframeElements = iframeDoc.querySelectorAll('[src], [href]');
            iframeElements.forEach(function(el) {
              ['src', 'href'].forEach(function(attr) {
                if (el.hasAttribute(attr)) {
                  var val = el.getAttribute(attr);
                  if (val && !isSpecial(val) && !isProxied(val)) {
                    try { el.setAttribute(attr, proxify(val)); } catch(e) {}
                  }
                }
              });
            });
          }
        } catch(e) {
          // Cross-origin iframe - can't access
        }
      });
      
    } catch(e) {}
  }
  
  // Run on DOMContentLoaded and load
  if (_document.readyState === 'loading') {
    _window.addEventListener('DOMContentLoaded', function() {
      _setTimeout(scanAndProxify, 0);
      _setTimeout(scanAndProxify, 100);
      _setTimeout(scanAndProxify, 500);
    });
  } else {
    _setTimeout(scanAndProxify, 0);
    _setTimeout(scanAndProxify, 100);
    _setTimeout(scanAndProxify, 500);
  }
  _window.addEventListener('load', function() {
    _setTimeout(scanAndProxify, 0);
    _setTimeout(scanAndProxify, 500);
    _setTimeout(scanAndProxify, 1000);
  });
  
  // Run periodically for dynamic content (more frequently)
  _setInterval(scanAndProxify, 1000);
  
  // Also run on any user interaction (lazy loading triggers)
  ['scroll', 'resize', 'click', 'mousemove', 'touchstart', 'touchmove'].forEach(function(evt) {
    var lastRun = 0;
    _window.addEventListener(evt, function() {
      var now = Date.now();
      if (now - lastRun > 500) {
        lastRun = now;
        _setTimeout(scanAndProxify, 100);
      }
    }, { passive: true });
  });
} catch(e) {}

// ========== REWRITE URL TO TARGET PATH (preserving ?url= param) ==========
// This is CRITICAL for client-side routing frameworks (e.g. Next.js).
// Object.defineProperty on window.location fails (non-configurable in Chrome),
// ========== REWRITE URL TO TARGET PATH ==========
// CRITICAL: location.pathname is UNFORGEABLE in browsers — it cannot be
// overridden via defineProperty on either the instance or the prototype.
// The ONLY way to make location.pathname return the target's path is to
// physically change the URL using replaceState.
//
// Format: /target/path?[embedded=1&]url=encoded_full_target
// Example: /en/g/tag?embedded=1&url=https%3A%2F%2Fpoki.com%2Fen%2Fg%2Ftag
//
// This ensures:
// 1. location.pathname returns the target path (for Next.js, React Router, etc.)
// 2. ?url= parameter is preserved for getCurrentTarget() and Referer-based resolution
try {
  var _targetUrlForRewrite = new _URL(__PROXY_TARGET__);
  var _searchParts = [];
  // Include target's own search params first
  if (_targetUrlForRewrite.search) {
    _searchParts.push(_targetUrlForRewrite.search.slice(1));
  }
  if (__PROXY_EMBEDDED__) {
    _searchParts.push('embedded=1');
  }
  _searchParts.push('url=' + _encodeURIComponent(__PROXY_TARGET__));
  var _newRewriteUrl = _targetUrlForRewrite.pathname + '?' + _searchParts.join('&') + (_targetUrlForRewrite.hash || '');
  if (_realLocationPathname === '/' || _realLocationSearch.indexOf('url=') !== -1) {
    _replaceState(_history.state, '', _newRewriteUrl);
  }
} catch(e) {}

} catch(globalError) {
  // If anything fails catastrophically, log but don't break the page
  try { console.error('[Proxy] Init error:', globalError); } catch(e) {}
    }
  
  })();
  </script>
`, { html: true });
    }
}

// --------------------
// Toolbar (minimal) - doesn't cover content
// --------------------
class InjectToolbar {
  constructor(targetUrl) {
    this.targetUrl = targetUrl;
  }
  element(el) {
    const targetUrl = this.targetUrl;
    const escaped = targetUrl.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    el.prepend(`
<style>
html{margin-top:44px!important}
body{margin-top:0!important}
#__proxy_toolbar__{position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;height:44px!important;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)!important;border-bottom:2px solid #0f3460!important;display:flex!important;align-items:center!important;padding:0 12px!important;gap:8px!important;z-index:2147483647!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif!important;box-shadow:0 2px 10px rgba(0,0,0,0.3)!important;box-sizing:border-box!important}
#__proxy_url_input__{flex:1!important;height:28px!important;background:rgba(255,255,255,0.1)!important;border:1px solid #0f3460!important;border-radius:6px!important;padding:0 12px!important;color:#eee!important;font-size:13px!important;outline:none!important;font-family:inherit!important}
#__proxy_url_input__:focus{border-color:#e94560!important}
#__proxy_url_input__::placeholder{color:#888!important}
</style>
<div id="__proxy_toolbar__">
  <a href="https://jimmyqrg.github.io/proxy/" target="_blank" style="display:flex;align-items:center;gap:8px;color:#e94560;font-weight:600;font-size:14px;flex-shrink:0;text-decoration:none;cursor:pointer;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>
    PROXY
  </a>
  <input type="text" id="__proxy_url_input__" value="${escaped}" placeholder="Enter URL and press Enter" onkeydown="if(event.key==='Enter'){var u=this.value.trim();if(u.indexOf('http')!==0)u='https://'+u;location.href='/?url='+encodeURIComponent(u);}">
</div>
`, { html: true });
  }
}

// --------------------
// JavaScript URL Rewriting
// --------------------
// DISABLED: rewriteJSUrls was causing SyntaxError in injected scripts and breaking
// third-party JavaScript. Client-side overrides (fetch, XHR, setAttribute, Element
// prototype setters, etc.) handle all these cases at runtime instead.
function rewriteJSUrls(js, base, isEmbedded) {
  return js; // Pass through unchanged
}

// --------------------
// JSON URL Rewriting (for manifest.json etc)
// --------------------
function rewriteJsonUrls(json, base, isEmbedded) {
  if (!json || typeof json !== 'string') return json;
  
  const prefix = isEmbedded ? "/?embedded=1&url=" : "/?url=";
  
  try {
    // Parse and walk the JSON to find URL-like values
    const parsed = JSON.parse(json);
    
    function walkAndRewrite(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(walkAndRewrite);
      }
      
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          // Check if this looks like a URL in a URL-related key
          const urlKeys = ['src', 'href', 'url', 'icon', 'icons', 'start_url', 'scope', 'background', 'action'];
          const isUrlKey = urlKeys.some(k => key.toLowerCase().includes(k));
          
          if (isUrlKey && value && (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/') || value.startsWith('./'))) {
            if (!value.includes('proxy.ikunbeautiful.workers.dev')) {
              try {
                const abs = new URL(value, base).toString();
                result[key] = prefix + encodeURIComponent(abs);
              } catch {
                result[key] = value;
              }
            } else {
              result[key] = value;
            }
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object') {
          result[key] = walkAndRewrite(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    
    return JSON.stringify(walkAndRewrite(parsed));
  } catch {
    return json;
  }
}

// --------------------
// SVG URL Rewriting
// --------------------
function rewriteSvgUrls(svg, base, isEmbedded) {
  if (!svg || typeof svg !== 'string') return svg;
  
  const prefix = isEmbedded ? "/?embedded=1&url=" : "/?url=";
  
  try {
    // Rewrite href attributes
    svg = svg.replace(/\shref\s*=\s*(['"])([^'"]+)\1/gi, (m, q, url) => {
      try {
        if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('javascript:')) return m;
        if (url.includes('proxy.ikunbeautiful.workers.dev')) return m;
        const abs = new URL(url, base).toString();
        return ` href=${q}${prefix}${encodeURIComponent(abs)}${q}`;
      } catch {
        return m;
      }
    });
    
    // Rewrite xlink:href attributes
    svg = svg.replace(/\sxlink:href\s*=\s*(['"])([^'"]+)\1/gi, (m, q, url) => {
      try {
        if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('javascript:')) return m;
        if (url.includes('proxy.ikunbeautiful.workers.dev')) return m;
        const abs = new URL(url, base).toString();
        return ` xlink:href=${q}${prefix}${encodeURIComponent(abs)}${q}`;
      } catch {
        return m;
      }
    });
    
    // Rewrite style url()
    svg = rewriteCSSUrls(svg, base, isEmbedded);
    
  } catch {}
  
  return svg;
}

// --------------------
// Header sanitization
// --------------------
function sanitizeHeaders(headers, isEmbedded) {
  const newHeaders = new Headers();
  const skipHeaders = new Set([
    // Frame/embedding restrictions
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    // Security headers that might interfere
    'x-content-type-options',
    'x-xss-protection',
    'strict-transport-security',
    'public-key-pins',
    'public-key-pins-report-only',
    'expect-ct',
    // Feature/permissions policies
    'feature-policy',
    'permissions-policy',
    // Cross-origin policies
    'cross-origin-opener-policy',
    'cross-origin-embedder-policy',
    'cross-origin-resource-policy',
    // Reporting
    'report-to',
    'nel',
    'reporting-endpoints',
    // Timing
    'timing-allow-origin',
    'server-timing',
    // Other potentially problematic headers
    'x-permitted-cross-domain-policies',
    'x-download-options',
    'x-dns-prefetch-control',
    'origin-agent-cluster',
    'document-policy',
    'require-document-policy'
  ]);
  
  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (!skipHeaders.has(lowerKey)) {
      // Rewrite Set-Cookie to remove domain/path restrictions
      if (lowerKey === 'set-cookie') {
        const sanitizedCookie = value
          .replace(/;\s*domain=[^;]*/gi, '')
          .replace(/;\s*secure/gi, '')
          .replace(/;\s*samesite=[^;]*/gi, '; SameSite=None');
        newHeaders.append(key, sanitizedCookie);
      } else {
        newHeaders.set(key, value);
      }
    }
  }
  
  // CORS headers - set permissive defaults.
  // NOTE: Access-Control-Allow-Origin will be patched later by fixCorsForRequest()
  // to echo the actual request Origin when credentials are involved, because
  // browsers reject wildcard (*) when credentials mode is 'include'.
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
  newHeaders.set('Access-Control-Allow-Headers', '*');
  newHeaders.set('Access-Control-Expose-Headers', '*');
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  // Ensure Referer is always sent (needed for bare-path fallback resolution)
  newHeaders.set('Referrer-Policy', 'unsafe-url');
  
  // Timing header for performance API
  newHeaders.set('Timing-Allow-Origin', '*');
  
  return newHeaders;
}

// Patch CORS headers to work with credentialed requests.
// When the browser sends credentials (cookies, Authorization, etc.),
// Access-Control-Allow-Origin MUST NOT be '*' — it must echo the
// actual request Origin. This function patches the headers in-place.
function fixCorsForRequest(headers, request) {
  const origin = request.headers.get('Origin');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

// --------------------
// Inline External Resources (CSS and JS)
// --------------------
async function inlineExternalResources(html, baseUrl, isEmbedded) {
  if (!html || typeof html !== 'string') return html;
  
  try {
    // Find all external stylesheets - handle various formats
    // Also handle src attribute (non-standard but sometimes used)
    const linkPatterns = [
      /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/gi,
      /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*\/?>/gi,
      /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi,
      /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi,
      // Handle src attribute (non-standard)
      /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*src\s*=\s*["']([^"']+)["'][^>]*\/?>/gi,
      /<link[^>]+src\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*\/?>/gi,
      /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi,
      /<link[^>]+src\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi
    ];
    
    // Find all external scripts
    const scriptPatterns = [
      /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*><\/script>/gi,
      /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*\/>/gi
    ];
    
    const resources = new Map();
    
    // Collect stylesheet URLs
    for (const pattern of linkPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        const fullTag = match[0];
        // Skip data: and blob: URLs, and already proxied URLs
        if (!url.startsWith('data:') && !url.startsWith('blob:') && 
            !url.includes('proxy.ikunbeautiful.workers.dev')) {
          try {
            const absUrl = new URL(url, baseUrl).toString();
            // Don't inline if already in map (avoid duplicates)
            if (!resources.has(fullTag)) {
              resources.set(fullTag, { type: 'css', url: absUrl, originalUrl: url });
            }
          } catch {}
        }
      }
    }
    
    // Collect script URLs
    for (const pattern of scriptPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        const fullTag = match[0];
        // Skip data: and blob: URLs, and already proxied URLs
        if (!url.startsWith('data:') && !url.startsWith('blob:') && 
            !url.includes('proxy.ikunbeautiful.workers.dev')) {
          try {
            const absUrl = new URL(url, baseUrl).toString();
            // Don't inline if already in map (avoid duplicates)
            if (!resources.has(fullTag)) {
              resources.set(fullTag, { type: 'js', url: absUrl, originalUrl: url });
            }
          } catch {}
        }
      }
    }
    
    // Fetch all resources in parallel
    const fetchPromises = [];
    for (const [tag, info] of resources) {
      fetchPromises.push(
        fetch(info.url, { 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': info.type === 'css' ? 'text/css,*/*;q=0.1' : 'application/javascript,*/*;q=0.1',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': baseUrl
          },
          redirect: 'follow'
        })
          .then(async r => {
            if (r.ok) {
              const text = await r.text();
              return { tag, info, content: text, success: true };
            }
            return { tag, info, content: '', success: false };
          })
          .catch(() => ({ tag, info, content: '', success: false }))
      );
    }
    
    const results = await Promise.all(fetchPromises);
    
    // Replace tags with inline content
    for (const { tag, info, content, success } of results) {
      if (!success || !content) continue;
      
      try {
        if (info.type === 'css') {
          // Rewrite URLs in CSS before inlining
          const rewrittenCss = rewriteCSSUrls(content, info.url, isEmbedded);
          // Escape the CSS for HTML
          const escapedCss = rewrittenCss
            .replace(/</g, '\\3C ')
            .replace(/>/g, '\\3E ');
          // Replace the link tag with style tag
          html = html.replace(tag, `<style>${escapedCss}</style>`);
        } else if (info.type === 'js') {
          // Rewrite URLs in JS before inlining
          const rewrittenJs = rewriteJSUrls(content, info.url, isEmbedded);
          // Escape the JS for HTML (handle </script>)
          const escapedJs = rewrittenJs.replace(/<\/script>/gi, '<\\/script>');
          // Replace the script tag with inline script
          // Preserve any attributes like type, async, defer, etc.
          const attrsMatch = tag.match(/<script([^>]*?)src[^>]*>/i);
          const attrs = attrsMatch ? attrsMatch[1].replace(/\ssrc\s*=\s*["'][^"']*["']/i, '') : '';
          html = html.replace(tag, `<script${attrs}>${escapedJs}</script>`);
        }
      } catch(e) {
        // If replacement fails, keep the original tag
        continue;
      }
    }
    
    return html;
  } catch(e) {
    // If anything fails, return original HTML
    return html;
    }
  }
  
// --------------------
// WebSocket Proxy Handler - NON-BLOCKING
// Returns 101 immediately so the browser's WebSocket handshake completes
// instantly. The target connection is established in the background.
// Messages from the client are queued until the target is connected.
// --------------------
function handleWebSocket(request, targetWsUrl) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  // --- State for background connection ---
  let targetWs = null;
  let targetReady = false;
  let targetFailed = false;
  const messageQueue = [];   // queued client messages before target is ready
  let serverClosed = false;

  // Listen for client messages immediately (before target connects)
  server.addEventListener('message', event => {
    if (targetReady && targetWs) {
      try { targetWs.send(event.data); } catch {}
    } else if (!targetFailed) {
      messageQueue.push(event.data);
    }
  });

  server.addEventListener('close', event => {
    serverClosed = true;
    if (targetWs) {
      try { targetWs.close(event.code || 1000, event.reason || ''); } catch {}
    }
  });

  server.addEventListener('error', () => {
    serverClosed = true;
    if (targetWs) {
      try { targetWs.close(1011, 'Client error'); } catch {}
    }
  });

  // --- Connect to target in background (non-blocking) ---
  (async () => {
    try {
      let fetchUrl = targetWsUrl;
      if (fetchUrl.startsWith('ws://'))  fetchUrl = 'http://'  + fetchUrl.slice(5);
      else if (fetchUrl.startsWith('wss://')) fetchUrl = 'https://' + fetchUrl.slice(6);

      const wsHeaders = new Headers();
      wsHeaders.set('Upgrade', 'websocket');
      wsHeaders.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0');
      try { wsHeaders.set('Origin', new URL(fetchUrl).origin); } catch {}

      const protocol = request.headers.get('Sec-WebSocket-Protocol');
      if (protocol) wsHeaders.set('Sec-WebSocket-Protocol', protocol);
      const extensions = request.headers.get('Sec-WebSocket-Extensions');
      if (extensions) wsHeaders.set('Sec-WebSocket-Extensions', extensions);
      const cookie = request.headers.get('Cookie');
      if (cookie) wsHeaders.set('Cookie', cookie);
      const auth = request.headers.get('Authorization');
      if (auth) wsHeaders.set('Authorization', auth);

      const targetResp = await fetch(fetchUrl, { headers: wsHeaders });
      targetWs = targetResp.webSocket;

      if (!targetWs) {
        targetFailed = true;
        if (!serverClosed) {
          try { server.close(1011, 'Target did not accept WebSocket upgrade'); } catch {}
        }
        return;
      }

      targetWs.accept();
      targetReady = true;

      // Flush queued messages from client
      while (messageQueue.length > 0) {
        try { targetWs.send(messageQueue.shift()); } catch {}
      }

      // If client already disconnected while we were connecting, close target
      if (serverClosed) {
        try { targetWs.close(1000, 'Client already closed'); } catch {}
        return;
      }

      // Relay: target → client
      targetWs.addEventListener('message', event => {
        if (!serverClosed) {
          try { server.send(event.data); } catch {}
        }
      });

      targetWs.addEventListener('close', event => {
        if (!serverClosed) {
          try { server.close(event.code || 1000, event.reason || ''); } catch {}
        }
      });

      targetWs.addEventListener('error', () => {
        if (!serverClosed) {
          try { server.close(1011, 'Target error'); } catch {}
        }
      });
    } catch (e) {
      targetFailed = true;
      if (!serverClosed) {
        try { server.close(1011, 'Connection failed'); } catch {}
      }
    }
  })();

  // Return 101 IMMEDIATELY - don't wait for the target connection
  return new Response(null, { status: 101, webSocket: client });
}
  
  // --------------------
  // Main Worker
  // --------------------
  export default {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      let target = url.searchParams.get("url");
      const wsTarget = url.searchParams.get("ws");
      let isEmbedded = url.searchParams.get("embedded") === "1";

    // Handle favicon.ico - return empty icon to prevent 404 noise
    if (url.pathname === '/favicon.ico' && !target && !wsTarget) {
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=86400' } });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      const corsOrigin = request.headers.get('Origin') || '*';
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
          ...(corsOrigin !== '*' ? { 'Vary': 'Origin' } : {})
        }
      });
    }

    // ========== WebSocket Proxy ==========
    if (wsTarget) {
      // Unwrap nested proxy WebSocket URLs.
      // A double-proxied URL looks like:
      //   ?ws=wss://proxy.ikunbeautiful.workers.dev/?ws=wss%3A%2F%2Freal-target...
      // We recursively extract the innermost ?ws= target.
      let finalWsTarget = wsTarget;
      for (let i = 0; i < 5; i++) { // max 5 unwrap iterations
        if (finalWsTarget.includes('proxy.ikunbeautiful.workers.dev')) {
          try {
            // Normalise ws(s) to http(s) so URL parsing works
            let parseUrl = finalWsTarget;
            if (parseUrl.startsWith('ws://')) parseUrl = 'http://' + parseUrl.slice(5);
            else if (parseUrl.startsWith('wss://')) parseUrl = 'https://' + parseUrl.slice(6);
            const inner = new URL(parseUrl).searchParams.get('ws');
            if (inner) {
              finalWsTarget = inner;
              continue;
            }
          } catch {}
          break; // Couldn't unwrap further
        }
        break; // Not a proxy URL, done
      }

      // Validate WebSocket target
      if (!finalWsTarget.startsWith('ws://') && !finalWsTarget.startsWith('wss://') && 
          !finalWsTarget.startsWith('http://') && !finalWsTarget.startsWith('https://')) {
        return new Response('Invalid WebSocket URL', { status: 400 });
      }
      if (finalWsTarget.includes('proxy.ikunbeautiful.workers.dev')) {
        return new Response('Cannot proxy WebSocket to self', { status: 400 });
      }
      // Handle WebSocket upgrade (case-insensitive check)
      const upgradeHeader = (request.headers.get('Upgrade') || '').toLowerCase();
      if (upgradeHeader === 'websocket') {
        return handleWebSocket(request, finalWsTarget);
      }
      // If not a WebSocket upgrade, return error
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
  
    // ========== BARE PATH FALLBACK ==========
    // If no ?url= parameter, try to resolve using Referer header or cookie.
    // This catches ALL cases where client-side URL interception misses:
    // - dynamically loaded images/scripts
    // - lazy loading
    // - CSS url() references
    // - location.href = "page/" if the client-side override fails
    // - WebSocket upgrades on bare paths
    if (!target) {
      const referer = request.headers.get('Referer') || '';
      let targetBase = '';
      let refEmbedded = false;

      // Method 1: Extract target origin from Referer header (?url= parameter)
      try {
        if (referer) {
          const refUrl = new URL(referer);
          const refTarget = refUrl.searchParams.get('url');
          if (refTarget) {
            targetBase = new URL(refTarget).origin;
            refEmbedded = refUrl.searchParams.get('embedded') === '1';
          }
        }
      } catch {}

      // Method 2: Cookie fallback (primary method after replaceState rewrites the URL)
      // After replaceState changes /?url=... to /target/path, the Referer no longer
      // has ?url= parameter, so the cookie is the most reliable source.
      if (!targetBase) {
        const cookies = request.headers.get('Cookie') || '';
        const match = cookies.match(/__proxy_target=([^;]+)/);
        if (match) {
          try { targetBase = decodeURIComponent(match[1]); } catch {}
        }
      }
      
      // Method 3: Check embedded parameter in Referer even without url param
      if (targetBase && !refEmbedded) {
        try {
          if (referer) {
            const refUrl = new URL(referer);
            if (refUrl.searchParams.get('embedded') === '1') {
              refEmbedded = true;
            }
          }
        } catch {}
      }

      if (targetBase) {
        // Reconstruct the full target URL from the bare path
        const fullTarget = targetBase + url.pathname + url.search;

        // Handle WebSocket upgrades on bare paths
        const bareUpgrade = (request.headers.get('Upgrade') || '').toLowerCase();
        if (bareUpgrade === 'websocket') {
          // Convert to wss:// URL for the WebSocket handler
          let wsUrl = fullTarget;
          if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
          else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
          return handleWebSocket(request, wsUrl);
        }

        // For navigation/document requests, REDIRECT so the URL updates properly
        // (this ensures getCurrentTarget() works on the loaded page)
        const secFetchDest = request.headers.get('Sec-Fetch-Dest') || '';
        const accept = request.headers.get('Accept') || '';
        const isNavigation = secFetchDest === 'document' || secFetchDest === 'iframe' ||
                             (accept.includes('text/html') && !accept.startsWith('image/'));

        if (isNavigation) {
          const prefix = refEmbedded ? '/?embedded=1&url=' : '/?url=';
          return Response.redirect(url.origin + prefix + encodeURIComponent(fullTarget), 302);
        }

        // For sub-resources (images, scripts, CSS, etc.), proxy directly
        // to avoid redirect overhead
        target = fullTarget;
        isEmbedded = refEmbedded;
      }

      if (!target) {
        return new Response("Missing ?url= parameter", { status: 400 });
      }
    }
    
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      return new Response("URL must start with http:// or https://", { status: 400 });
    }

    // Prevent infinite loops
    if (target.includes("proxy.ikunbeautiful.workers.dev")) {
      return new Response("Cannot proxy the proxy itself", { status: 400 });
    }
  
      try {
      const requestHeaders = new Headers();
      requestHeaders.set("User-Agent", request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      requestHeaders.set("Accept", request.headers.get("Accept") || "*/*");
      requestHeaders.set("Accept-Language", request.headers.get("Accept-Language") || "en-US,en;q=0.9");
      // DO NOT set Accept-Encoding explicitly! When it's set, Workers runtime
      // skips automatic decompression, meaning resp.text() would read raw
      // compressed bytes as UTF-8 → garbage. Let Workers handle it automatically.
      requestHeaders.set("Referer", target);
      
      // Forward important headers
      const forwardHeaders = ['Cookie', 'Authorization', 'Content-Type', 'Content-Length', 'Range', 'If-None-Match', 'If-Modified-Since'];
      for (const h of forwardHeaders) {
        const val = request.headers.get(h);
        if (val) requestHeaders.set(h, val);
      }

      const fetchOptions = {
        method: request.method,
        headers: requestHeaders,
        redirect: 'manual'
      };

      // Forward body
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        fetchOptions.body = request.body;
      }

      // Add timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      fetchOptions.signal = controller.signal;

      let resp;
      try {
        resp = await fetch(target, fetchOptions);
      } finally {
        clearTimeout(timeoutId);
      }

      // Handle redirects (limit to 10)
      let redirectCount = 0;
      let currentTarget = target;
      while (resp.status >= 300 && resp.status < 400 && redirectCount < 10) {
        const location = resp.headers.get('Location');
        if (!location) break;
        
        // Resolve relative redirects (like "/") against the current target
        let resolvedLocation;
        try {
          resolvedLocation = new URL(location, currentTarget).toString();
        } catch {
          // If URL parsing fails, try to construct it manually
          if (location.startsWith('/')) {
            try {
              const baseUrl = new URL(currentTarget);
              resolvedLocation = baseUrl.origin + location;
            } catch {
              resolvedLocation = location;
            }
          } else {
            resolvedLocation = location;
          }
        }
        
        // Update currentTarget for next iteration
        currentTarget = resolvedLocation;
        
        // If redirecting to the same proxy, prevent infinite loop
        if (resolvedLocation.includes("proxy.ikunbeautiful.workers.dev")) {
          break;
        }
        
        // Follow the redirect
        try {
          const redirectHeaders = new Headers(requestHeaders);
          redirectHeaders.set("Referer", resolvedLocation);
          
          const redirectOptions = {
            method: 'GET', // Redirects are typically GET
            headers: redirectHeaders,
            redirect: 'manual'
          };
          
          const redirectController = new AbortController();
          const redirectTimeoutId = setTimeout(() => redirectController.abort(), 30000);
          
          try {
            resp = await fetch(resolvedLocation, { ...redirectOptions, signal: redirectController.signal });
          } finally {
            clearTimeout(redirectTimeoutId);
          }
          
          redirectCount++;
        } catch(e) {
          // If redirect fetch fails, return the redirect response
          break;
        }
      }
      
      // If we ended with a redirect status, return the proxied redirect
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('Location');
        if (location) {
          let resolvedLocation;
          try {
            resolvedLocation = new URL(location, currentTarget).toString();
          } catch {
            if (location.startsWith('/')) {
              try {
                const baseUrl = new URL(currentTarget);
                resolvedLocation = baseUrl.origin + location;
              } catch {
                resolvedLocation = location;
              }
            } else {
              resolvedLocation = location;
            }
          }
          
          const prefix = isEmbedded ? "/?embedded=1&url=" : "/?url=";
          const redirectCorsOrigin = request.headers.get('Origin') || '*';
          return new Response(null, {
            status: resp.status,
          headers: { 
              'Location': prefix + encodeURIComponent(resolvedLocation),
              'Access-Control-Allow-Origin': redirectCorsOrigin,
              'Access-Control-Allow-Credentials': 'true',
              ...(redirectCorsOrigin !== '*' ? { 'Vary': 'Origin' } : {})
            }
          });
        }
      }
  
        const contentType = resp.headers.get("content-type") || "";
      const sanitizedHeaders = sanitizeHeaders(resp.headers, isEmbedded);
      fixCorsForRequest(sanitizedHeaders, request);

      // Helper: strip compression headers for text-processed responses.
      // Workers' fetch() auto-decompresses when we call resp.text(), so the
      // body string is uncompressed but the original Content-Encoding header
      // remains. We must remove it so the browser doesn't try to decompress again.
      function stripCompressionHeaders(hdrs) {
        hdrs.delete('content-encoding');
        hdrs.delete('content-length');
        hdrs.delete('transfer-encoding');
        return hdrs;
      }

      // HTML
        if (contentType.includes("text/html")) {
        // Set a cookie with the target origin so bare-path requests can be resolved
        // even when the Referer header is missing (e.g. no-referrer policy)
        // Only set on HTML responses to avoid unnecessary cookie overhead on every resource
        try {
          const targetOrigin = new URL(target).origin;
          sanitizedHeaders.set('Set-Cookie', 
            '__proxy_target=' + encodeURIComponent(targetOrigin) + 
            '; Path=/; SameSite=None; Secure; Max-Age=86400');
        } catch {}
        // Read HTML as text first to inline external resources
        let htmlText = await resp.text();
        
        // DISABLED: Inlining external CSS/JS was causing double-proxification of URLs,
        // JS corruption, 503 timeouts, and font corruption. LinkRewriter/ScriptRewriter
        // already rewrite <link href> and <script src> attributes, and CSS url()
        // references are handled by rewriteCSSUrls when CSS is fetched through the proxy.
        // try { htmlText = await inlineExternalResources(htmlText, target, isEmbedded); } catch(e) {}
        
        // Now apply HTMLRewriter to the inlined HTML
        let rewriter = new HTMLRewriter()
          .on("base", new BaseRewriter(target, isEmbedded))
          .on("meta", new MetaRewriter(target, isEmbedded))
          .on("a", new AnchorRewriter(target, isEmbedded))
          .on("link", new LinkRewriter(target, isEmbedded))
          .on("img", new ImageRewriter(target, isEmbedded))
          .on("picture source", new SourceRewriter(target, isEmbedded))
          .on("video", new VideoRewriter(target, isEmbedded))
          .on("video source", new SourceRewriter(target, isEmbedded))
          .on("audio", new AudioRewriter(target, isEmbedded))
          .on("audio source", new SourceRewriter(target, isEmbedded))
          .on("script", new ScriptRewriter(target, isEmbedded))
          .on("iframe", new IFrameRewriter(target, isEmbedded))
          .on("frame", new IFrameRewriter(target, isEmbedded))
          .on("frameset frame", new IFrameRewriter(target, isEmbedded))
          .on("form", new FormRewriter(target, isEmbedded))
          .on("button[formaction]", new FormActionRewriter(target, isEmbedded))
          .on("input[formaction]", new FormActionRewriter(target, isEmbedded))
          .on("object", new ObjectRewriter(target, isEmbedded))
          .on("embed", new EmbedRewriter(target, isEmbedded))
          .on("applet", new GenericUrlRewriter(target, isEmbedded))
          .on("style", new StyleRewriter(target, isEmbedded))
          .on("[style]", new InlineStyleRewriter(target, isEmbedded))
          .on("area", new AnchorRewriter(target, isEmbedded))
          .on("track", new SourceRewriter(target, isEmbedded))
          .on("input[type='image']", new ImageRewriter(target, isEmbedded))
          .on("svg [href]", new SVGRewriter(target, isEmbedded))
          .on("svg [xlink\\:href]", new SVGRewriter(target, isEmbedded))
          .on("use", new SVGRewriter(target, isEmbedded))
          .on("image", new SVGRewriter(target, isEmbedded))
          .on("[background]", new GenericUrlRewriter(target, isEmbedded))
          .on("[poster]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data]", new GenericUrlRewriter(target, isEmbedded))
          .on("[cite]", new GenericUrlRewriter(target, isEmbedded))
          .on("[longdesc]", new GenericUrlRewriter(target, isEmbedded))
          .on("[formaction]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-src]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-href]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-url]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-background]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-image]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-lazy-src]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-original]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-bg]", new GenericUrlRewriter(target, isEmbedded))
          .on("[data-poster]", new GenericUrlRewriter(target, isEmbedded))
          .on("head", new InjectNavigationFix(target, isEmbedded));
        
        if (!isEmbedded) {
          rewriter = rewriter.on("body", new InjectToolbar(target));
        }
        
        // Create a new Response from the inlined HTML and apply rewriter
        // Strip compression headers since resp.text() already decompressed the body
        stripCompressionHeaders(sanitizedHeaders);
        return rewriter.transform(new Response(htmlText, {
          status: resp.status,
          statusText: resp.statusText,
          headers: sanitizedHeaders
        }));
        }
  
      // CSS
      if (contentType.includes("text/css") || contentType.includes("stylesheet")) {
        const css = await resp.text();
        stripCompressionHeaders(sanitizedHeaders);
        return new Response(rewriteCSSUrls(css, target, isEmbedded), {
          status: resp.status,
          statusText: resp.statusText,
          headers: sanitizedHeaders
        });
      }
      
      // JSON (for manifest.json and other configs) - rewrite URL values
      if (contentType.includes("application/json") || contentType.includes("application/manifest+json")) {
        try {
          const json = await resp.text();
          stripCompressionHeaders(sanitizedHeaders);
          const rewritten = rewriteJsonUrls(json, target, isEmbedded);
          return new Response(rewritten, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        } catch {
          // If JSON rewriting fails, return original
          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        }
      }
      
      // SVG - rewrite href/xlink:href attributes
      if (contentType.includes("image/svg+xml")) {
        try {
          const svg = await resp.text();
          stripCompressionHeaders(sanitizedHeaders);
          const rewritten = rewriteSvgUrls(svg, target, isEmbedded);
          return new Response(rewritten, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        } catch {
          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        }
      }
      
      // JavaScript - try to rewrite URL strings
      if (contentType.includes("javascript") || contentType.includes("text/javascript") || 
          contentType.includes("application/x-javascript") || contentType.includes("text/ecmascript")) {
        try {
          const js = await resp.text();
          stripCompressionHeaders(sanitizedHeaders);
          const rewritten = rewriteJSUrls(js, target, isEmbedded);
          return new Response(rewritten, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        } catch {
          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        }
      }
      
      // XML/XHTML - rewrite URLs similar to HTML
      if (contentType.includes("text/xml") || contentType.includes("application/xml") || 
          contentType.includes("application/xhtml+xml")) {
        try {
          const xml = await resp.text();
          stripCompressionHeaders(sanitizedHeaders);
          const rewritten = rewriteSvgUrls(xml, target, isEmbedded); // Reuse SVG rewriter
          return new Response(rewritten, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        } catch {
          return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: sanitizedHeaders
          });
        }
      }

      // Server-Sent Events (SSE) - stream through as-is
      if (contentType.includes("text/event-stream")) {
        return new Response(resp.body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: sanitizedHeaders
        });
      }

      // Everything else - pass through
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: sanitizedHeaders
      });
  
      } catch (e) {
      const errorMessage = e.name === 'AbortError' ? 'Request timeout (30s)' : e.message;
      return new Response(`Proxy error: ${errorMessage}`, { 
        status: 502,
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
      });
      }
    }
  };
