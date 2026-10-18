function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export function renderLiveGuestPage(matchId: string, homeScore: number, awayScore: number): string {
  const safeMatchId = escapeHtml(matchId);
  const jsMatchId = escapeJsString(matchId);
  const bannerText = `${homeScore} - ${awayScore}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Live — ${safeMatchId}</title>
</head>
<body>
  <video id="guest-video-player"></video>
  <div id="live-score-banner">${escapeHtml(bannerText)}</div>
  <div id="pinned-merch-card" data-variant-id="var-jersey-001-L">Jersey L</div>
  <button type="button" id="add-to-guest-cart-btn" data-variant-id="var-jersey-001-L">Add to cart</button>
  <span id="guest-cart-count">0</span>
  <ul id="chat-message-list"></ul>
  <input id="chat-input-field" type="text" autocomplete="off">
  <button type="button" id="chat-send-btn">Send</button>
  <div id="progressive-auth-modal" hidden style="display:none">Sign in to continue</div>
  <script>
(function () {
  var matchId = '${jsMatchId}';
  var banner = document.getElementById('live-score-banner');
  var modal = document.getElementById('progressive-auth-modal');
  var chatList = document.getElementById('chat-message-list');
  var chatInput = document.getElementById('chat-input-field');
  var cartCount = document.getElementById('guest-cart-count');

  function refreshScore() {
    fetch('/audit/v1/score/' + matchId)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.home && data.away) {
          banner.textContent = data.home.score + ' - ' + data.away.score;
        }
      })
      .catch(function () {});
  }
  setInterval(refreshScore, 1000);

  document.getElementById('chat-send-btn').addEventListener('click', function () {
    chatInput.value = '';
    modal.hidden = false;
    modal.style.display = 'block';
  });

  document.getElementById('add-to-guest-cart-btn').addEventListener('click', function () {
    cartCount.textContent = '1';
  });
})();
  </script>
</body>
</html>`;
}

export function renderStubPage(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body>
</html>`;
}
