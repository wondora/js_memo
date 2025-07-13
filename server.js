const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const CryptoJS = require('crypto-js');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 3000;

// CORS 설정 (필요시)
app.use(cors({
  origin: [
   // 'https://memo2.fji.kr',  
    'http://10.114.2.101:3000',
    //'https://100.124.253.64:3000',   	
  ],
  credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// DB 연결 및 테이블 생성
const db = new sqlite3.Database('memo.db');
db.serialize(() => {
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

// API 라우트
app.post('/api/password', (req, res) => {
  const { pw } = req.body;
  const hash = CryptoJS.SHA256(pw).toString(CryptoJS.enc.Hex);
  db.run('INSERT OR REPLACE INTO password (id, pw) VALUES (1, ?)', [hash], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});
app.post('/api/password/check', (req, res) => {
  const { pw } = req.body;
  const hash = CryptoJS.SHA256(pw).toString(CryptoJS.enc.Hex);
  db.get('SELECT pw FROM password WHERE id = 1', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: '패스워드가 설정되지 않음' });
    res.json({ match: row.pw === hash });
  });
});
app.get('/api/memos', (req, res) => {
  db.all('SELECT * FROM memos ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // attachedFiles가 있으면 JSON 파싱
    rows.forEach(row => {
      if (row.attachedFiles) {
        try { row.attachedFiles = JSON.parse(row.attachedFiles); } catch (e) { row.attachedFiles = []; }
      }
    });
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
    res.json({ id: this.lastID });
  });
});
app.put('/api/memos/:id', (req, res) => {
  const { title, content } = req.body;
  db.run('UPDATE memos SET title = ?, content = ? WHERE id = ?', [title, content, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
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

// 업로드 파일 목록 API
app.get('/api/files', (req, res) => {
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
    res.json(fileInfos);
  });
});

// 업로드 파일 정적 서빙
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
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

// ENCRYPTED_PW 반환 API
app.get('/api/env-pw', (req, res) => {
  res.json({ pw: process.env.ENCRYPTED_PW || '' });
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
