# 추자초 5학년 말바당 사전 — 배포용 프로젝트

Claude 미리보기에서 만든 `jeju-dictionary-app.jsx`를 실제 인터넷에 배포할 수 있는
React(Vite) 프로젝트로 옮기고, 저장소를 Firebase Firestore로 교체한 버전이에요.

## 1. Firebase 프로젝트 만들기 (딱 한 번만 하면 돼요)

1. https://console.firebase.google.com 접속 → 구글 계정으로 로그인
2. "프로젝트 추가" → 이름 입력(예: jeju-dictionary) → Google Analytics는 꺼도 됨 → 프로젝트 생성
3. 왼쪽 메뉴 "빌드 > Firestore Database" → "데이터베이스 만들기" → 위치는 asia-northeast3(서울) 선택 →
   처음에는 "테스트 모드"로 시작(30일간 누구나 읽기/쓰기 가능, 나중에 보안 규칙을 손볼 수 있어요)
4. 왼쪽 상단 톱니바퀴 "프로젝트 설정" → 맨 아래 "내 앱" → 웹 아이콘(`</>`) 클릭 → 앱 닉네임 아무거나 입력 → 등록
5. 화면에 뜨는 `firebaseConfig` 객체의 값들을 복사해둬요. 예시:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "jeju-dictionary.firebaseapp.com",
     projectId: "jeju-dictionary",
     storageBucket: "jeju-dictionary.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef",
   };
   ```

## 2. 이 프로젝트에 설정값 넣기

1. 이 폴더에서 `.env.example` 파일을 복사해서 `.env` 파일을 만들어요.
2. `.env` 파일을 열어서 방금 복사한 값들을 하나씩 채워넣어요.
   ```
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=jeju-dictionary.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=jeju-dictionary
   VITE_FIREBASE_STORAGE_BUCKET=jeju-dictionary.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
   ```
   (`.env`는 `.gitignore`에 이미 포함돼 있어서 GitHub에는 올라가지 않아요. 대신 Vercel에 배포할 때
   같은 값들을 Vercel의 "Environment Variables"에 한 번 더 입력해줘야 해요.)

## 3. 로컬에서 실행해보기

터미널(명령 프롬프트)에서 이 폴더로 이동한 뒤:

```bash
npm install
npm run dev
```

터미널에 뜨는 주소(보통 http://localhost:5173)를 브라우저로 열어서
낱말 등록, 이미지 첨부, 음성 녹음, 관리자 승인까지 한 번씩 테스트해보세요.
문제없이 되면 Firebase 콘솔의 Firestore Database에도 `words`, `wordMedia`, `meta` 컬렉션이 자동으로 생기는 걸 확인할 수 있어요.

## 4. GitHub에 올리고 Vercel로 배포하기

```bash
git init
git add .
git commit -m "제주말 사전 배포 준비"
```

GitHub에서 새 저장소를 만든 뒤 안내에 따라 `git remote add origin ...` 하고 `git push -u origin main`.

그 다음 https://vercel.com 에서 GitHub 계정으로 로그인 → "Add New Project" → 방금 만든 저장소 선택 →
"Environment Variables"에 `.env`에 적었던 값들을 똑같이 하나씩 입력 → Deploy.

몇 분 뒤 `https://프로젝트이름.vercel.app` 같은 실제 주소가 생기고,
이후로는 GitHub에 push할 때마다 자동으로 다시 배포돼요.

## 알아두면 좋은 점

- **관리자 PIN**: 지금은 코드에 `0640`이 그대로 적혀있는 데모용이에요. 공개 배포 전에
  `src/App.jsx`의 `ADMIN_PIN` 값을 바꾸거나, 별도 로그인 방식으로 교체하는 걸 권장해요.
- **이미지·음성 용량 제한**: Firestore 문서 하나는 최대 1MB까지만 저장할 수 있어요.
  그래서 이 버전은 Claude 미리보기 버전보다 이미지(약 500KB)·음성(각 200KB) 제한을 줄여뒀어요.
  나중에 더 큰 파일을 다루고 싶으면 Firebase Storage(유료 Blaze 요금제 필요) 또는
  Cloudinary 같은 이미지 호스팅 서비스로 옮기는 걸 고려해보세요. (Claude 미리보기 안에서는
  샌드박스 제한 때문에 이런 외부 업로드가 막히지만, 실제 배포된 사이트에서는 정상 작동해요.)
- **Firestore 보안 규칙**: "테스트 모드"는 30일 후 자동으로 잠겨요. 계속 쓰려면 Firebase 콘솔의
  Firestore Database > 규칙 탭에서 기간을 연장하거나 규칙을 다시 설정해야 해요.
- **닉네임 저장 방식**: "등록자 닉네임"은 각자 기기(브라우저)에만 저장돼요(localStorage). 다른
  기기로 접속하면 다시 입력해야 해요.
- **불러오는 속도 최적화**: 낱말의 글자 정보(`words` 컬렉션)와 이미지·음성(`wordMedia` 컬렉션)을
  분리해서 저장해요. 사전 목록·검색·정렬 화면은 가벼운 글자 정보만 불러오고, 이미지·음성은
  낱말 상세 페이지를 열 때만 그때그때 불러오기 때문에 사전에 낱말이 많이 쌓여도 처음 들어갈 때
  느려지지 않아요. (브라우저 로컬 캐시 기능은 저장 성공 여부를 화면에서 확인하기 어렵게 만들어서
  뺐어요 — 등록·수정할 때마다 실제 서버와 바로 통신해서, 실패하면 화면에 바로 에러가 떠요.)
- **저장·불러오기 에러 확인**: 등록/수정/삭제가 실패하면 화면 위에 빨간 배너로 에러 메시지가
  떠요. 그 문구가 원인을 알려주니, 문제가 생기면 그 문구를 그대로 확인해보세요.
