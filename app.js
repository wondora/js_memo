let memos = [];
let editId = null;
let currentPage = 1;
const MEMOS_PER_PAGE = 20;
let passwordVerified = false; // 비밀번호 확인 상태 저장
let searchTimeout = null; // 검색 디바운싱용
let isLoading = false; // 로딩 상태 관리

const memoList = document.getElementById("memoList");
const modal = document.getElementById("modal");
const memoTitle = document.getElementById("memoTitle");
const memoContent = document.getElementById("memoContent");
const modalTitle = document.getElementById("modalTitle");
const pagination = document.getElementById("pagination");
const loadingIndicator = document.getElementById("loadingIndicator");
const searchInput = document.getElementById("searchInput");

//const API = "http://localhost:3000/api";
//const API = "http://100.124.253.64:3000/api";
//const API = "http://10.114.2.101:3000/api";
const API = "/api";

// 로딩 상태 관리 함수
function showLoading() {
  isLoading = true;
  loadingIndicator.style.display = 'block';
  memoList.style.display = 'none';
}

function hideLoading() {
  isLoading = false;
  loadingIndicator.style.display = 'none';
  memoList.style.display = 'block';
}

// 디바운싱 함수
function debounce(func, wait) {
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(searchTimeout);
      func(...args);
    };
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(later, wait);
  };
}

// 클립보드 이미지 붙여넣기 처리 함수
function handlePaste(e) {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      
      reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
          // 캔버스를 사용하여 이미지 압축
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // 이미지 크기 조정 (최대 너비 800px)
          let { width, height } = img;
          const maxWidth = 800;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // 이미지를 캔버스에 그리기
          ctx.drawImage(img, 0, 0, width, height);
          
          // 압축된 이미지 데이터 (품질 0.8)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
          
          // 압축된 이미지 요소 생성
          const compressedImg = document.createElement('img');
          compressedImg.src = compressedDataUrl;
          compressedImg.style.maxWidth = '100%';
          compressedImg.style.height = 'auto';
          compressedImg.style.margin = '10px 0';
          compressedImg.style.borderRadius = '8px';
          compressedImg.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
          
          // 현재 커서 위치에 이미지 삽입
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(compressedImg);
            range.collapse(false);
          } else {
            // 커서가 없으면 텍스트 영역 끝에 추가
            memoContent.appendChild(compressedImg);
          }
          
          // 줄바꿈 추가
          const br = document.createElement('br');
          memoContent.appendChild(br);
        };
        img.src = event.target.result;
      };
      
      reader.readAsDataURL(blob);
      e.preventDefault();
      break;
    }
  }
}

// 메모 내용 영역을 contenteditable로 변경하고 붙여넣기 이벤트 추가
function setupContentEditable() {
  memoContent.contentEditable = true;
  const placeholder = document.getElementById('memoPlaceholder');

  function togglePlaceholder() {
    if (memoContent.innerText.trim() === '' && memoContent.childNodes.length === 0) {
      placeholder.style.display = '';
    } else if (memoContent.innerText.trim() === '' && memoContent.innerHTML === '<br>') {
      placeholder.style.display = '';
    } else {
      placeholder.style.display = 'none';
    }
  }

  memoContent.addEventListener('paste', handlePaste);
  memoContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
    setTimeout(togglePlaceholder, 0);
  });
  memoContent.addEventListener('input', togglePlaceholder);
  memoContent.addEventListener('focus', togglePlaceholder);
  memoContent.addEventListener('blur', togglePlaceholder);

  // 최초 상태
  togglePlaceholder();
}

// 서버에서 메모 목록 불러오기 (캐싱 추가)
let memoCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30초 캐시

async function fetchMemos(filter = "") {
  const now = Date.now();
  
  // 캐시가 유효하고 필터가 없으면 캐시 사용
  if (memoCache && (now - lastFetchTime) < CACHE_DURATION && !filter) {
    renderMemos(filter);
    return;
  }
  
  if (isLoading) return; // 이미 로딩 중이면 중복 요청 방지
  
  showLoading();
  
  try {
    const res = await fetch(`${API}/memos`);
    if (!res.ok) throw new Error('Network response was not ok');
    
    memos = await res.json();
    memoCache = [...memos]; // 캐시 업데이트
    lastFetchTime = now;
    
    renderMemos(filter);
  } catch (error) {
    console.error('메모 로딩 실패:', error);
    hideLoading();
    // 에러 상태 표시
    memoList.innerHTML = '<li class="text-center text-red-600 py-4">메모를 불러오는데 실패했습니다.</li>';
  }
}

// 서버에 패스워드 확인 요청
async function checkPassword() {
  const code = prompt("비밀번호를 입력하세요.");
  if (!code) return false;
  const res = await fetch(`${API}/password/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pw: code })
  });
  const data = await res.json();
  if (!data.match) {
    alert("잘못된 숫자입니다.");
    return false;
  }
  return true;
}

// URL을 자동으로 링크로 변환하는 함수
function linkify(text) {
  const urlPattern = /(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)|(www\.[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/gi;
  return text.replace(urlPattern, function(url) {
    let href = url;
    if (!href.startsWith('http')) href = 'http://' + href;
    return `<a href="${href}" target="_blank" class="text-blue-500 underline">${url}</a>`;
  });
}

// 메모 렌더링 최적화 (가상화 적용)
function renderMemos(filter = "") {
  memoList.innerHTML = "";
  let filtered = memos.filter(m => m.title.includes(filter));
  const totalPages = Math.ceil(filtered.length / MEMOS_PER_PAGE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const startIdx = (currentPage - 1) * MEMOS_PER_PAGE;
  const endIdx = startIdx + MEMOS_PER_PAGE;
  const pageMemos = filtered.slice(startIdx, endIdx);

  // DocumentFragment 사용으로 DOM 조작 최적화
  const fragment = document.createDocumentFragment();

  pageMemos.forEach((memo) => {
    const li = document.createElement("li");
    li.className = "bg-yellow-100 p-4 rounded shadow flex flex-col items-start";

    const content = document.createElement("div");
    const dateStr = memo.date ? `<span class='text-xs text-gray-500 ml-2'>${memo.date}</span>` : '';
    content.innerHTML = `<div class='font-bold'>${memo.title}${dateStr}</div><div class='text-sm text-gray-600 mt-1 whitespace-pre-wrap'>${linkify(memo.content)}</div>`;
    li.appendChild(content);

    // 여러 첨부파일 표시
    if (memo.attachedFiles && Array.isArray(memo.attachedFiles) && memo.attachedFiles.length > 0) {
      const fileDiv = document.createElement('div');
      fileDiv.className = 'mt-2 flex flex-wrap gap-2';
      // 안전하게 링크 생성 (textContent 사용)
      memo.attachedFiles.forEach(f => {
        const a = document.createElement('a');
        a.href = `/uploads/${encodeURIComponent(f.filename)}`;
        a.download = f.originalname;
        a.className = 'text-blue-600 underline';
        a.textContent = `📎 ${f.originalname}`;
        fileDiv.appendChild(a);
        fileDiv.appendChild(document.createTextNode(' '));
      });
      li.appendChild(fileDiv);
    } else if (memo.attachedFile) {
      // 구버전 호환
      const fileDiv = document.createElement('div');
      fileDiv.className = 'mt-2';
      const a = document.createElement('a');
      a.href = `/uploads/${encodeURIComponent(memo.attachedFile)}`;
      a.download = '';
      a.className = 'text-blue-600 underline';
      a.textContent = `📎 ${memo.attachedFile}`;
      fileDiv.appendChild(a);
      li.appendChild(fileDiv);
    }

    const actions = document.createElement("div");
    actions.className = "space-x-2 text-sm text-right self-end";
    actions.innerHTML = `
      <button onclick="editMemo(${memo.id})" class="text-blue-600">수정</button>
      <button onclick="deleteMemo(${memo.id})" class="text-red-600">삭제</button>
    `;
    li.appendChild(actions);
    memoList.appendChild(li);
  });

  // 페이지네이션 UI
  pagination.innerHTML = "";
  if (totalPages > 1) {
    // 이전 버튼
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "<";
    prevBtn.className = `px-3 py-1 rounded ${currentPage === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-100 text-blue-600'}`;
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => { currentPage--; renderMemos(filter); };
    pagination.appendChild(prevBtn);

    // 페이지 번호
    for (let i = 1; i <= totalPages; i++) {
      // 1, 2, ... n
      if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.className = `px-3 py-1 rounded mx-1 ${i === currentPage ? 'bg-blue-600 text-white font-bold' : 'bg-white hover:bg-blue-100 text-blue-600'}`;
        btn.onclick = () => { currentPage = i; renderMemos(filter); };
        pagination.appendChild(btn);
      } else if (
        (i === currentPage - 3 && i > 1) ||
        (i === currentPage + 3 && i < totalPages)
      ) {
        const span = document.createElement("span");
        span.textContent = "...";
        span.className = "px-2 text-gray-400";
        pagination.appendChild(span);
      }
    }

    // 다음 버튼
    const nextBtn = document.createElement("button");
    nextBtn.textContent = ">";
    nextBtn.className = `px-3 py-1 rounded ${currentPage === totalPages ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-100 text-blue-600'}`;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => { currentPage++; renderMemos(filter); };
    pagination.appendChild(nextBtn);
  }
  hideLoading();
}

function showModal(edit = false) {
  modal.classList.remove("hidden");
  modalTitle.textContent = edit ? "메모 수정" : "새 메모";
  setTimeout(() => { memoTitle.focus(); }, 0);
  // 파일명 표시 초기화
  const fileInput = document.getElementById('memoFileInput');
  const selectedFiles = document.getElementById('selectedFiles');
  if (fileInput) fileInput.value = '';
  if (selectedFiles) selectedFiles.textContent = '';
}

function hideModal() {
  modal.classList.add("hidden");
  memoTitle.value = "";
  memoContent.innerHTML = "";
  editId = null;
  passwordVerified = false; // 비밀번호 확인 상태 초기화
  // placeholder 표시
  const placeholder = document.getElementById('memoPlaceholder');
  if (placeholder) placeholder.style.display = '';
}

document.getElementById("newMemoBtn").onclick = () => {
  showModal();
};

document.getElementById("cancelBtn").onclick = hideModal;

document.getElementById("saveBtn").onclick = async () => {
  const title = memoTitle.value.trim();
  let content = memoContent.innerHTML.trim();
  if (content === '<span style="color: #9ca3af;">내용</span>') {
    content = '';
  }
  if (!title) return alert("제목을 입력하세요.");

  const today = new Date();
  const date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // 첨부파일 업로드
  const memoFileInput = document.getElementById('memoFileInput');
  let attachedFiles = [];
  if (memoFileInput && memoFileInput.files.length > 0) {
    // 진행바 표시
    const progressContainer = document.getElementById('uploadProgressContainer');
    const progressBar = document.getElementById('uploadProgressBar');
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadPercent = document.getElementById('uploadPercent');
    const uploadDetails = document.getElementById('uploadDetails');
    const saveBtn = document.getElementById('saveBtn');
    
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    uploadPercent.textContent = '0%';
    uploadDetails.textContent = '';
    saveBtn.disabled = true;
    saveBtn.textContent = '업로드 중...';
    
    const totalFiles = memoFileInput.files.length;
    let completedFiles = 0;
    
    for (let i = 0; i < memoFileInput.files.length; i++) {
      const file = memoFileInput.files[i];
      
      try {
        // 현재 파일 업로드 상태 업데이트
        uploadStatus.textContent = `업로드 중... (${i + 1}/${totalFiles})`;
        uploadDetails.textContent = `파일: ${file.name}`;
        
        // XMLHttpRequest를 사용하여 실제 업로드 진행률 추적
        const result = await uploadFileWithProgress(file, (progress, details) => {
          const totalProgress = ((completedFiles + progress) / totalFiles) * 100;
          progressBar.style.width = Math.min(totalProgress, 100) + '%';
          uploadPercent.textContent = Math.min(Math.round(totalProgress), 100) + '%';
          
          // 상세 정보 업데이트
          if (details) {
            uploadDetails.textContent = `${details.loaded} / ${details.total} (${details.speed}) - ${details.remaining} 남음`;
          }
        });
        
        attachedFiles.push({ filename: result.filename, originalname: result.originalname });
        completedFiles++;
        
        // 개별 파일 업로드 완료 시 100% 표시
        const totalProgress = (completedFiles / totalFiles) * 100;
        progressBar.style.width = Math.min(totalProgress, 100) + '%';
        uploadPercent.textContent = Math.min(Math.round(totalProgress), 100) + '%';
        
      } catch (e) {
        // 진행바 숨기고 에러 표시
        progressContainer.classList.add('hidden');
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
        alert('파일 업로드 실패: ' + e.message);
        return;
      }
    }
    
    // 업로드 완료 후 진행바 숨기기
    uploadStatus.textContent = '업로드 완료!';
    uploadPercent.textContent = '100%';
    progressBar.style.width = '100%';
    uploadDetails.textContent = '모든 파일이 성공적으로 업로드되었습니다.';
    
    // 1초 후 진행바 숨기기
    setTimeout(() => {
      progressContainer.classList.add('hidden');
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }, 1000);
  }

  try {
    if (editId !== null) {
      // 수정
      if (!passwordVerified) {
        const ok = await checkPassword();
        if (!ok) return;
        passwordVerified = true;
      }
      const response = await fetch(`${API}/memos/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } else {
      // 추가
      const response = await fetch(`${API}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, date, attachedFiles })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    await fetchMemos();
    hideModal();
  } catch (error) {
    console.error('저장 중 오류 발생:', error);
    alert('저장 중 오류가 발생했습니다: ' + error.message);
  }
};

window.editMemo = async function(id) {
  const ok = await checkPassword();
  if (!ok) return;
  passwordVerified = true; // 비밀번호 확인 완료
  const memo = memos.find(m => m.id === id);
  if (!memo) return;
  editId = id;
  memoTitle.value = memo.title;
  memoContent.innerHTML = memo.content;
  showModal(true);
  // placeholder 표시 여부 갱신
  const placeholder = document.getElementById('memoPlaceholder');
  if (placeholder) {
    if (memo.content && memo.content.trim() !== '') {
      placeholder.style.display = 'none';
    } else {
      placeholder.style.display = '';
    }
  }
};

window.deleteMemo = async function(id) {
  const ok = await checkPassword();
  if (!ok) return;
  if (confirm("정말 삭제하시겠습니까?")) {
    await fetch(`${API}/memos/${id}`, { method: "DELETE" });
    await fetchMemos();
  }
};

// 검색 기능에 디바운싱 적용
const debouncedSearch = debounce((value) => {
  currentPage = 1;
  renderMemos(value);
}, 300);

document.getElementById("searchInput").oninput = (e) => {
  debouncedSearch(e.target.value);
};

fetchMemos();

// contenteditable 설정 초기화
setupContentEditable();

// 키보드 이벤트 리스너 추가
document.addEventListener('keydown', (e) => {
  // Shift + I 키를 누르면 새 메모 작성 (대소문자 구별 없음)
  if (e.shiftKey && (e.key.toLowerCase() === 'i' || e.key.toUpperCase() === 'I')) {
    e.preventDefault(); // 기본 동작 방지
    showModal();
  }
});

// 파일 업로드 및 목록 기능
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileList = document.getElementById('fileList');

// 파일 업로드
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert('업로드할 파일을 선택하세요.');
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  uploadBtn.disabled = true;
  uploadBtn.textContent = '업로드 중...';
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('업로드 실패');
    fileInput.value = '';
    await fetchFileList();
    alert('업로드 성공!');
  } catch (e) {
    alert('업로드 실패: ' + e.message);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '업로드';
  }
});

// 파일 목록 불러오기
async function fetchFileList() {
  fileList.innerHTML = '<li>불러오는 중...</li>';
  try {
    const res = await fetch('/api/files');
    const files = await res.json();
    if (!Array.isArray(files) || files.length === 0) {
      fileList.innerHTML = '<li class="text-gray-400">업로드된 파일이 없습니다.</li>';
      return;
    }
    fileList.innerHTML = '';
    files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    files.forEach(f => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between bg-gray-50 rounded px-3 py-2 shadow';
      li.innerHTML = `
        <span class="truncate max-w-xs">${f.filename}</span>
        <span class="text-xs text-gray-400 ml-2">${(f.size/1024).toFixed(1)} KB</span>
        <a href="/uploads/${f.filename}" download class="ml-4 px-2 py-1 bg-blue-500 text-white rounded text-xs">다운로드</a>
      `;
      fileList.appendChild(li);
    });
  } catch (e) {
    fileList.innerHTML = '<li class="text-red-500">목록 불러오기 실패</li>';
  }
}

// 페이지 로드 시 파일 목록 표시
fetchFileList();

// 파일 업로드 진행률 추적 함수
function uploadFileWithProgress(file, progressCallback) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    
    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    
    // 업로드 진행률 이벤트
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.min((e.loaded / e.total) * 100, 100);
        const currentTime = Date.now();
        const timeDiff = (currentTime - lastTime) / 1000; // 초 단위
        const loadedDiff = e.loaded - lastLoaded;
        
        // 업로드 속도 계산 (KB/s)
        const speed = timeDiff > 0 ? (loadedDiff / 1024 / timeDiff).toFixed(1) : 0;
        
        // 남은 시간 계산
        const remainingBytes = e.total - e.loaded;
        const remainingTime = speed > 0 ? (remainingBytes / 1024 / speed).toFixed(1) : 0;
        
        // 파일 크기 포맷팅
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
        
        progressCallback(progress, {
          loaded: formatBytes(e.loaded),
          total: formatBytes(e.total),
          speed: speed + ' KB/s',
          remaining: remainingTime + '초'
        });
        
        lastLoaded = e.loaded;
        lastTime = currentTime;
      }
    });
    
    // 요청 완료 이벤트
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (e) {
          reject(new Error('서버 응답 파싱 실패'));
        }
      } else {
        reject(new Error(`업로드 실패: ${xhr.status}`));
      }
    });
    
    // 에러 이벤트
    xhr.addEventListener('error', () => {
      reject(new Error('네트워크 오류'));
    });
    
    // 요청 전송
    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  });
}

// 파일 input에서 선택된 파일명 표시
function setupFileInputDisplay() {
  const fileInput = document.getElementById('memoFileInput');
  const selectedFiles = document.getElementById('selectedFiles');
  if (!fileInput || !selectedFiles) return;
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length === 0) {
      selectedFiles.textContent = '';
    } else {
      const names = Array.from(fileInput.files).map(f => f.name).join(', ');
      selectedFiles.textContent = names;
    }
  });
}

setupFileInputDisplay();

// crypto-js 불러오기 필요
const CryptoJS = require('crypto-js');

// 환경변수 또는 하드코딩된 비밀번호 해시값 반환
app.get('/api/env-pw', (req, res) => {
  // 3895의 SHA-256 해시값
  const hash = CryptoJS.SHA256('3895').toString(CryptoJS.enc.Hex);
  res.json({ pw: hash });
});
