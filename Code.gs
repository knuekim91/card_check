/**
 * 우리가족 카드 사용 현황 - Apps Script 백엔드
 * 이 스크립트를 "우리가족 카드 사용 현황 - 데이터" 구글시트에 연결해서 사용합니다.
 */

var CARDS_SHEET = 'Cards';
var EXPENSES_SHEET = 'Expenses';
var DEFAULT_CARDS = ['롯데카드(헬로티비)', '롯데카드(재홍)', '우리카드(재홍)', '삼성카드(정이)', '현금사용'];
var CATEGORIES = ['식비', '생활용품', '교육', '의료/건강', '보험', '통신', '교통/주유', '문화/여가', '카드값/대출', '기타'];
var PARKING_SHEET = 'Parking';
var PARKING_LOCATIONS = ['지하2층', '지하3층', '지하4층', '다른곳'];

// 대구 기준 좌표. 다른 지역이면 이 값을 바꿔주세요.
var WEATHER_LAT = 35.8714;
var WEATHER_LON = 128.6014;

var WEATHER_CODE_MAP = {
  0: { icon: '☀️', label: '맑음' },
  1: { icon: '🌤️', label: '대체로 맑음' },
  2: { icon: '⛅', label: '구름 조금' },
  3: { icon: '☁️', label: '흐림' },
  45: { icon: '🌫️', label: '안개' },
  48: { icon: '🌫️', label: '안개' },
  51: { icon: '🌦️', label: '이슬비' },
  53: { icon: '🌦️', label: '이슬비' },
  55: { icon: '🌦️', label: '이슬비' },
  56: { icon: '🌧️', label: '어는 이슬비' },
  57: { icon: '🌧️', label: '어는 이슬비' },
  61: { icon: '🌧️', label: '비' },
  63: { icon: '🌧️', label: '비' },
  65: { icon: '🌧️', label: '강한 비' },
  66: { icon: '🌧️', label: '어는 비' },
  67: { icon: '🌧️', label: '어는 비' },
  71: { icon: '🌨️', label: '눈' },
  73: { icon: '🌨️', label: '눈' },
  75: { icon: '🌨️', label: '강한 눈' },
  77: { icon: '🌨️', label: '싸락눈' },
  80: { icon: '🌦️', label: '소나기' },
  81: { icon: '🌦️', label: '소나기' },
  82: { icon: '⛈️', label: '강한 소나기' },
  85: { icon: '🌨️', label: '소나기 눈' },
  86: { icon: '🌨️', label: '소나기 눈' },
  95: { icon: '⛈️', label: '뇌우' },
  96: { icon: '⛈️', label: '뇌우(우박)' },
  99: { icon: '⛈️', label: '뇌우(우박)' }
};

var WEATHER_RAINY_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
var WEATHER_SUNNY_CODES = [0, 1];

function weatherMessage_(code) {
  if (WEATHER_RAINY_CODES.indexOf(code) !== -1) {
    return '오뎅탕에 소주 한잔 어때? 🍢🍶';
  }
  if (WEATHER_SUNNY_CODES.indexOf(code) !== -1) {
    return '정이야 오늘도 힘찬 하루 잘 보내. 사랑해 ☀️';
  }
  return '비록 날씨는 흐리더라도 당신을 향한 내 마음은 불타오르고 있어 🔥';
}

var KAKAO_REDIRECT_URI = 'https://script.google.com/macros/s/AKfycbzFC0_S1LBaKLJNULCRzImiW12yRE-91nSzRqUWKBCBYjp95jkFLbr6krwDKmM4TyH-/exec';

function doGet(e) {
  if (e && e.parameter && e.parameter.code && e.parameter.state) {
    return handleKakaoCallback_(e.parameter.code, e.parameter.state);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('우리가족 카드 사용 현황')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ensureSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cardsSheet = ss.getSheetByName(CARDS_SHEET);
  if (!cardsSheet) {
    cardsSheet = ss.insertSheet(CARDS_SHEET);
    cardsSheet.appendRow(['id', 'name', 'createdAt']);
    DEFAULT_CARDS.forEach(function (name) {
      cardsSheet.appendRow([Utilities.getUuid(), name, new Date()]);
    });
  }
  var expSheet = ss.getSheetByName(EXPENSES_SHEET);
  if (!expSheet) {
    expSheet = ss.insertSheet(EXPENSES_SHEET);
    expSheet.appendRow(['id', 'cardId', 'date', 'item', 'amount', 'category', 'createdAt']);
  } else {
    var header = expSheet.getRange(1, 1, 1, Math.max(expSheet.getLastColumn(), 1)).getValues()[0];
    if (header.indexOf('category') === -1) {
      expSheet.insertColumnAfter(5);
      expSheet.getRange(1, 6).setValue('category');
    }
  }
  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (defaultSheet && ss.getSheets().length > 2 && defaultSheet.getLastRow() === 0) {
    try { ss.deleteSheet(defaultSheet); } catch (err) { /* ignore */ }
  }
  return { cardsSheet: cardsSheet, expSheet: expSheet };
}

function parseDate_(dateStr) {
  var parts = dateStr.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function toDate_(value) {
  return value instanceof Date ? value : parseDate_(value);
}

// "정산월" 규칙: 전월 11일 ~ 당월 10일. 11일 이후는 해당 월, 10일 이하는 전월로 귀속.
function getBillingKey_(dateObj) {
  var y = dateObj.getFullYear();
  var m = dateObj.getMonth() + 1;
  var d = dateObj.getDate();
  if (d <= 10) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return y + '-' + (m < 10 ? '0' + m : m);
}

function getBillingRange_(key) {
  var parts = key.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var start = new Date(y, m - 1, 11, 0, 0, 0);
  var end = new Date(y, m, 10, 23, 59, 59);
  return { start: start, end: end };
}

function shiftBillingKey_(key, delta) {
  var parts = key.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) + delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' + m : m);
}

function formatPeriodLabel_(key) {
  var parts = key.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var nm = m + 1, ny = y;
  if (nm > 12) { nm = 1; ny += 1; }
  var endLabel = (ny !== y) ? (nm + '.10 (' + ny + '년)') : (nm + '.10');
  return y + '년 ' + m + '월 사용분 (' + m + '.11 ~ ' + endLabel + ')';
}

function getCards() {
  var s = ensureSheets_();
  var rows = s.cardsSheet.getDataRange().getValues();
  var cards = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) cards.push({ id: rows[i][0], name: rows[i][1] });
  }
  return cards;
}

function addCard(name) {
  name = (name || '').trim();
  if (!name) throw new Error('카드 이름을 입력해주세요.');
  var s = ensureSheets_();
  var existing = getCards();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].name === name) throw new Error('이미 존재하는 카드 이름입니다.');
  }
  var id = Utilities.getUuid();
  s.cardsSheet.appendRow([id, name, new Date()]);
  return { id: id, name: name };
}

function deleteCard(id) {
  var s = ensureSheets_();
  var expRows = s.expSheet.getDataRange().getValues();
  for (var i = 1; i < expRows.length; i++) {
    if (expRows[i][1] === id) {
      throw new Error('이 카드에 등록된 사용 내역이 있어 삭제할 수 없습니다. 먼저 관련 내역을 삭제해주세요.');
    }
  }
  var cardRows = s.cardsSheet.getDataRange().getValues();
  for (var j = 1; j < cardRows.length; j++) {
    if (cardRows[j][0] === id) {
      s.cardsSheet.deleteRow(j + 1);
      return true;
    }
  }
  throw new Error('카드를 찾을 수 없습니다.');
}

function getMonthData(billingKey) {
  var s = ensureSheets_();
  if (!billingKey) billingKey = getBillingKey_(new Date());
  var range = getBillingRange_(billingKey);
  var prevKey = shiftBillingKey_(billingKey, -1);
  var prevRange = getBillingRange_(prevKey);
  var cards = getCards();
  var rows = s.expSheet.getDataRange().getValues();
  var expenses = [];
  var prevGrandTotal = 0;
  var tz = Session.getScriptTimeZone();
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue;
    var d = toDate_(row[2]);
    if (d >= range.start && d <= range.end) {
      expenses.push({
        id: row[0],
        cardId: row[1],
        dateISO: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
        dateLabel: Utilities.formatDate(d, tz, 'M.d'),
        item: row[3],
        amount: Number(row[4]),
        category: row[5] || '기타'
      });
    } else if (d >= prevRange.start && d <= prevRange.end) {
      prevGrandTotal += Number(row[4]);
    }
  }
  expenses.sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : (a.dateISO > b.dateISO ? 1 : 0); });

  var totalsByCard = {};
  cards.forEach(function (c) { totalsByCard[c.id] = 0; });
  var totalsByCategory = {};
  CATEGORIES.forEach(function (cat) { totalsByCategory[cat] = 0; });
  var grandTotal = 0;
  expenses.forEach(function (e) {
    totalsByCard[e.cardId] = (totalsByCard[e.cardId] || 0) + e.amount;
    totalsByCategory[e.category] = (totalsByCategory[e.category] || 0) + e.amount;
    grandTotal += e.amount;
  });

  return {
    billingKey: billingKey,
    periodLabel: formatPeriodLabel_(billingKey),
    cards: cards,
    categories: CATEGORIES,
    expenses: expenses,
    totalsByCard: totalsByCard,
    totalsByCategory: totalsByCategory,
    grandTotal: grandTotal,
    prevGrandTotal: prevGrandTotal,
    prevKey: prevKey,
    nextKey: shiftBillingKey_(billingKey, 1)
  };
}

function addExpense(cardId, dateStr, item, amount, category) {
  item = (item || '').trim();
  amount = Number(amount);
  category = category || '기타';
  if (!cardId) throw new Error('카드를 선택해주세요.');
  if (!dateStr) throw new Error('날짜를 선택해주세요.');
  if (!item) throw new Error('항목을 입력해주세요.');
  if (!amount || amount <= 0) throw new Error('금액을 올바르게 입력해주세요.');
  var s = ensureSheets_();
  var id = Utilities.getUuid();
  var dateObj = parseDate_(dateStr);
  s.expSheet.appendRow([id, cardId, dateObj, item, amount, category, new Date()]);
  return getBillingKey_(dateObj);
}

function updateExpense(id, cardId, dateStr, item, amount, category) {
  item = (item || '').trim();
  amount = Number(amount);
  category = category || '기타';
  if (!id) throw new Error('수정할 내역을 찾을 수 없습니다.');
  if (!cardId) throw new Error('카드를 선택해주세요.');
  if (!dateStr) throw new Error('날짜를 선택해주세요.');
  if (!item) throw new Error('항목을 입력해주세요.');
  if (!amount || amount <= 0) throw new Error('금액을 올바르게 입력해주세요.');
  var s = ensureSheets_();
  var rows = s.expSheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      var dateObj = parseDate_(dateStr);
      s.expSheet.getRange(i + 1, 2, 1, 5).setValues([[cardId, dateObj, item, amount, category]]);
      return getBillingKey_(dateObj);
    }
  }
  throw new Error('내역을 찾을 수 없습니다.');
}

function deleteExpense(id) {
  var s = ensureSheets_();
  var rows = s.expSheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      s.expSheet.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error('내역을 찾을 수 없습니다.');
}

function ensureParkingSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PARKING_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PARKING_SHEET);
    sheet.appendRow(['id', 'location', 'recordedAt']);
  }
  return sheet;
}

function getParkingStatus() {
  var sheet = ensureParkingSheet_();
  var rows = sheet.getDataRange().getValues();
  var tz = Session.getScriptTimeZone();
  var latestRow = null;
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue;
    var recordedAt = row[2] instanceof Date ? row[2] : new Date(row[2]);
    if (!latestRow || recordedAt > latestRow.recordedAt) {
      latestRow = { location: row[1], recordedAt: recordedAt };
    }
  }
  if (!latestRow) return null;
  return {
    location: latestRow.location,
    recordedAtLabel: Utilities.formatDate(latestRow.recordedAt, tz, 'M월 d일 HH시 mm분')
  };
}

function setParkingLocation(location) {
  if (PARKING_LOCATIONS.indexOf(location) === -1) throw new Error('올바른 위치를 선택해주세요.');
  var sheet = ensureParkingSheet_();
  var id = Utilities.getUuid();
  var now = new Date();
  sheet.appendRow([id, location, now]);
  var tz = Session.getScriptTimeZone();
  var label = Utilities.formatDate(now, tz, 'M월 d일 HH시 mm분');
  var message = '🚗 차량 위치: ' + location + '\n기록시간: ' + label;
  sendKakaoMemo_('me', message);
  sendKakaoMemo_('spouse', message);
  return {
    location: location,
    recordedAtLabel: label
  };
}

function kakaoRestApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('KAKAO_REST_API_KEY');
  if (!key) throw new Error('카카오 REST API 키가 스크립트 속성에 설정되지 않았습니다.');
  return key;
}

function kakaoClientSecret_() {
  return PropertiesService.getScriptProperties().getProperty('KAKAO_CLIENT_SECRET') || '';
}

function kakaoFingerprint_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, value);
  return digest.map(function (b) {
    var v = (b + 256) % 256;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').slice(0, 8);
}

function kakaoTokenPayload_(base) {
  var secret = kakaoClientSecret_();
  if (secret) base.client_secret = secret;
  return base;
}

function getKakaoLoginUrl(who) {
  var key = kakaoRestApiKey_();
  return 'https://kauth.kakao.com/oauth/authorize' +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(key) +
    '&redirect_uri=' + encodeURIComponent(KAKAO_REDIRECT_URI) +
    '&scope=talk_message' +
    '&state=' + encodeURIComponent(who);
}

function getKakaoConnectionStatus() {
  var props = PropertiesService.getScriptProperties();
  return {
    me: !!props.getProperty('KAKAO_TOKEN_me'),
    spouse: !!props.getProperty('KAKAO_TOKEN_spouse')
  };
}

function handleKakaoCallback_(code, who) {
  if (who !== 'me' && who !== 'spouse') {
    return HtmlService.createHtmlOutput('<p>잘못된 요청입니다.</p>');
  }
  var key = kakaoRestApiKey_();
  var secret = kakaoClientSecret_();
  var payload = {
    grant_type: 'authorization_code',
    client_id: key,
    redirect_uri: KAKAO_REDIRECT_URI,
    code: code
  };
  if (secret) payload.client_secret = secret;
  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded;charset=utf-8',
    payload: payload,
    muteHttpExceptions: true
  });
  var rawBody = res.getContentText();
  var data = JSON.parse(rawBody);
  if (data.error) {
    var debugInfo = 'REST API 키 길이: ' + key.length + '자, 지문: ' + kakaoFingerprint_(key) + '<br>' +
      'Client Secret 길이: ' + secret.length + '자, 지문: ' + kakaoFingerprint_(secret) + '<br>' +
      'Redirect URI: ' + KAKAO_REDIRECT_URI + '<br>' +
      '인가 코드 길이: ' + code.length + '자<br>' +
      'HTTP 상태 코드: ' + res.getResponseCode() + '<br>' +
      '전체 응답: ' + rawBody;
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">' +
      '<h2>❌ 카카오 연결 실패</h2><p>' + (data.error_description || data.error) + '</p>' +
      '<hr><p style="font-size:12px;color:#888;text-align:left;display:inline-block;">' + debugInfo + '</p>' +
      '</body></html>'
    );
  }
  var token = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date().getTime() + (data.expires_in * 1000)
  };
  PropertiesService.getScriptProperties().setProperty('KAKAO_TOKEN_' + who, JSON.stringify(token));
  var label = who === 'spouse' ? '아내' : '나';
  return HtmlService.createHtmlOutput(
    '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">' +
    '<h2>✅ ' + label + ' 카카오톡 연결 완료!</h2>' +
    '<p>이 창은 닫으셔도 됩니다.</p>' +
    '</body></html>'
  );
}

function ensureKakaoToken_(who) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('KAKAO_TOKEN_' + who);
  if (!raw) return null;
  var token = JSON.parse(raw);
  if (token.expires_at - 60000 > new Date().getTime()) {
    return token.access_token;
  }
  var key = kakaoRestApiKey_();
  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    payload: kakaoTokenPayload_({
      grant_type: 'refresh_token',
      client_id: key,
      refresh_token: token.refresh_token
    }),
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (data.error) {
    Logger.log('카카오 토큰 갱신 실패(' + who + '): ' + res.getContentText());
    return null;
  }
  token.access_token = data.access_token;
  token.expires_at = new Date().getTime() + (data.expires_in * 1000);
  if (data.refresh_token) token.refresh_token = data.refresh_token;
  props.setProperty('KAKAO_TOKEN_' + who, JSON.stringify(token));
  return token.access_token;
}

function sendKakaoMemo_(who, message) {
  try {
    var accessToken = ensureKakaoToken_(who);
    if (!accessToken) return false;
    var templateObject = {
      object_type: 'text',
      text: message,
      link: { web_url: KAKAO_REDIRECT_URI, mobile_web_url: KAKAO_REDIRECT_URI },
      button_title: '앱 열기'
    };
    var res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: { template_object: JSON.stringify(templateObject) },
      muteHttpExceptions: true
    });
    Logger.log('카카오 메시지 전송(' + who + '): ' + res.getResponseCode());
    return res.getResponseCode() === 200;
  } catch (err) {
    Logger.log('카카오 메시지 전송 에러(' + who + '): ' + err);
    return false;
  }
}

function getWeatherInfo() {
  try {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LAT + '&longitude=' + WEATHER_LON +
      '&current=temperature_2m,weather_code&daily=precipitation_probability_max&timezone=Asia%2FSeoul';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    Logger.log('날씨 응답 코드: ' + res.getResponseCode());
    if (res.getResponseCode() !== 200) {
      Logger.log('날씨 응답 본문: ' + res.getContentText());
      return null;
    }
    var data = JSON.parse(res.getContentText());
    Logger.log('날씨 데이터: ' + JSON.stringify(data));
    var code = data.current.weather_code;
    var temp = Math.round(data.current.temperature_2m);
    var pop = data.daily.precipitation_probability_max[0];
    var meta = WEATHER_CODE_MAP[code] || { icon: '🌡️', label: '' };
    var message = weatherMessage_(code);
    return {
      tempC: temp,
      precipProbability: pop,
      icon: meta.icon,
      label: meta.label,
      message: message
    };
  } catch (err) {
    Logger.log('날씨 에러: ' + err);
    return null;
  }
}
