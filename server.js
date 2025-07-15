const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const compression = require('compression'); // 압축 미들웨어 추가
const CryptoJS = require('crypto-js'); // 반드시 맨 위에 한 번만!

const app = express();
const PORT = 3000;

// 압축 미들웨어 추가 (gzip 압축)
app.use(compression());

// CORS 설정 (필요시)
app.use(cors({
  origin: [
    'https://memo2.fji.kr',  
    //'http://10.114.2.101:3000',
    'https://100.124.253.64:3000',   	
  ],
  credentials: true
}));

// 정적 파일 캐싱 설정
app.use(express.static(path.join(__dirname), {
  maxAge: '1h', // 1시간 캐시
  etag: true
}));

// body-parser 미들웨어가 누락되어 있으면 추가
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// DB 연결 및 테이블 생성 (성능 최적화)
const db = new sqlite3.Database('memo.db');
db.serialize(() => {
  // WAL 모드 활성화로 동시성 향상
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA cache_size = 10000');
  db.run('PRAGMA temp_store = MEMORY');
  
  db.run(`CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    date TEXT,
    attachedFile TEXT,
    attachedFiles TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS password (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pw TEXT NOT NULL
  )`);
  
  // 인덱스 추가로 검색 성능 향상
  db.run('CREATE INDEX IF NOT EXISTS idx_memos_title ON memos(title)');
  db.run('CREATE INDEX IF NOT EXISTS idx_memos_date ON memos(date)');
});

// 파일 업로드 설정
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      let originalname = file.originalname;
      // 한글 파일명 복원 (latin1 → utf8)
      if (typeof originalname === 'string') {
        originalname = Buffer.from(originalname, 'latin1').toString('utf8');
      }
      const ext = path.extname(originalname);
      const safeName = uuidv4() + ext;
      file.originalname = originalname; // 복원된 한글로 덮어쓰기
      cb(null, safeName);
    }
  })
});

// 메모 캐시 (메모리 캐싱)
let memoCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30초

// 캐시 무효화 함수
function invalidateCache() {
  memoCache = null;
  cacheTimestamp = 0;
}

// API 라우트
// 비밀번호 저장
app.post('/api/password', (req, res) => {
  if (!req.body || !req.body.pw) {
    return res.status(400).json({ error: 'pw 값이 필요합니다.' });
  }
  const { pw } = req.body;
  const hash = CryptoJS.SHA256(pw).toString(CryptoJS.enc.Hex);
  db.run('INSERT OR REPLACE INTO password (id, pw) VALUES (1, ?)', [hash], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 비밀번호 체크
app.post('/api/password/check', (req, res) => {
  if (!req.body || !req.body.pw) {
    return res.status(400).json({ error: 'pw 값이 필요합니다.' });
  }
  const { pw } = req.body;
  const hash = CryptoJS.SHA256(pw).toString(CryptoJS.enc.Hex);
  db.get('SELECT pw FROM password WHERE id = 1', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: '패스워드가 설정되지 않음' });
    res.json({ match: row.pw === hash });
  });
});

app.get('/api/memos', (req, res) => {
  const now = Date.now();
  
  // 캐시가 유효하면 캐시된 데이터 반환
  if (memoCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return res.json(memoCache);
  }
  
  db.all('SELECT * FROM memos ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // attachedFiles가 있으면 JSON 파싱
    rows.forEach(row => {
      if (row.attachedFiles) {
        try { row.attachedFiles = JSON.parse(row.attachedFiles); } catch (e) { row.attachedFiles = []; }
      }
    });
    
    // 캐시 업데이트
    memoCache = rows;
    cacheTimestamp = now;
    
    res.json(rows);
  });
});

app.post('/api/memos', (req, res) => {
  const { title, content, date, attachedFile, attachedFiles } = req.body;
  // attachedFiles는 [{filename, originalname}] 배열로 저장
  db.run('INSERT INTO memos (title, content, date, attachedFile, attachedFiles) VALUES (?, ?, ?, ?, ?)', [title, content, date, attachedFile || null, attachedFiles ? JSON.stringify(attachedFiles) : null], function(err) {
    if (err) {
      console.error('SQLite INSERT 오류:', err.message);
      return res.status(500).json({ error: '메모 저장 실패.', details: err.message });
    }
    invalidateCache(); // 캐시 무효화
    res.json({ id: this.lastID });
  });
});

app.put('/api/memos/:id', (req, res) => {
  const { title, content } = req.body;
  db.run('UPDATE memos SET title = ?, content = ? WHERE id = ?', [title, content, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    invalidateCache(); // 캐시 무효화
    res.json({ success: true });
  });
});

app.delete('/api/memos/:id', (req, res) => {
  db.get('SELECT attachedFile, attachedFiles FROM memos WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const attachedFile = row && row.attachedFile;
    let attachedFiles = [];
    if (row && row.attachedFiles) {
      try { attachedFiles = JSON.parse(row.attachedFiles); } catch (e) { attachedFiles = []; }
    }
    db.run('DELETE FROM memos WHERE id = ?', [req.params.id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      // 여러 첨부파일 삭제 (uuid 파일명)
      if (attachedFiles && attachedFiles.length > 0) {
        attachedFiles.forEach(fileObj => {
          const filePath = path.join('uploads', fileObj.filename);
          fs.unlink(filePath, () => {});
        });
      }
      // 단일 첨부파일(구버전 호환)
      if (attachedFile) {
        const filePath = path.join('uploads', attachedFile);
        fs.unlink(filePath, () => {});
      }
      invalidateCache(); // 캐시 무효화
      res.json({ success: true });
    });
  });
});

// 파일 업로드 API
app.post('/api/upload', upload.single('file'), (req, res) => {
  console.log('originalname:', req.file.originalname);
  if (!req.file) return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
  res.json({ success: true, filename: req.file.filename, originalname: req.file.originalname });
});

// 업로드 파일 목록 API (캐싱 추가)
let fileListCache = null;
let fileListCacheTime = 0;
const FILE_CACHE_DURATION = 60000; // 1분

app.get('/api/files', (req, res) => {
  const now = Date.now();
  
  // 캐시가 유효하면 캐시된 데이터 반환
  if (fileListCache && (now - fileListCacheTime) < FILE_CACHE_DURATION) {
    return res.json(fileListCache);
  }
  
  fs.readdir('uploads', (err, files) => {
    if (err) return res.status(500).json({ error: err.message });
    // 파일명, 원본명, 업로드 시간 등 정보 제공
    const fileInfos = files.map(filename => {
      const stat = fs.statSync(path.join('uploads', filename));
      return {
        filename,
        size: stat.size,
        mtime: stat.mtime
      };
    });
    
    // 캐시 업데이트
    fileListCache = fileInfos;
    fileListCacheTime = now;
    
    res.json(fileInfos);
  });
});

// 업로드 파일 정적 서빙 (캐싱 설정)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d', // 1일 캐시
  etag: true
}));

// 1. API 라우트가 먼저 오도록 배치
app.get('/api/env-pw', (req, res) => {
  const CryptoJS = require('crypto-js');
  const hash = CryptoJS.SHA256('3895').toString(CryptoJS.enc.Hex);
  res.json({ pw: hash });
});

// 2. 그 다음에 정적 파일 서빙
app.use(express.static(path.join(__dirname)));

// /로 접속 시 login.html 반환
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// /index.html로 접속 시 index.html 반환
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 첨부파일 삭제 API
app.post('/api/deletefile', (req, res) => {
  const { memoId, filename } = req.body;
  if (!filename) return res.status(400).json({ error: '파일명이 필요합니다.' });
  const filePath = path.join('uploads', filename);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') return res.status(500).json({ error: err.message });
    if (memoId) {
      db.run('UPDATE memos SET attachedFile = NULL WHERE id = ?', [memoId], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        invalidateCache(); // 캐시 무효화
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  });
});

// 첨부파일 다운로드 전용 API (uuid로 원본 파일명 유지)
app.get('/download/:uuid', (req, res) => {
  const uuid = req.params.uuid;
  db.get('SELECT attachedFiles FROM memos WHERE attachedFiles LIKE ?', [`%${uuid}%`], (err, row) => {
    if (err || !row) return res.status(404).send('File not found');
    let found = null;
    if (row.attachedFiles) {
      try {
        const arr = JSON.parse(row.attachedFiles);
        found = arr.find(f => f.filename === uuid);
      } catch (e) {}
    }
    if (!found) return res.status(404).send('File not found');
    const filePath = path.join(__dirname, 'uploads', found.filename);

    // 한글 파일명 Content-Disposition 헤더 추가
    const filename = encodeURIComponent(found.originalname);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.download(filePath, found.originalname);
  });
});

// server.js 파일 맨 마지막, app.listen() 바로 위에 추가
app.use((err, req, res, next) => {
    console.error('처리되지 않은 서버 오류:', err.stack); // 전체 스택 트레이스 로그
    res.status(500).json({ error: '예기치 않은 서버 오류가 발생했습니다.' });
});

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`웹서버 및 API 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
