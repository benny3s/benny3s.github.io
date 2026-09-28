# 밴드매니저 · 약속 잡자 → Firebase 이전 인수인계

작성: 2026-09-28 (클라우드 세션 분석 결과). PC 세션에서 이어서 작업하기 위한 문서입니다.

## 목표

1. 밴드매니저(`benny3s/band-manager`)와 약속 잡자(`benny3s/meet`)를 Apps Script + 구글 시트에서 **Firebase(Firestore)** 로 이전
2. 약속 잡자를 먼저 보완한 뒤, 그 **더 깔끔한 UI를 밴드매니저로 이식**
3. PC의 `secretary` 폴더(AI 공부 자료)에 UI 참고 자료가 있으면 반영 — **아직 확인 못 함, PC 세션에서 먼저 볼 것**

## 미결정 사항 (사용자 확인 필요)

1. **Firebase 프로젝트** — 새로 만들기 추천. bridge가 쓰는 `benny-meeting`을 공유하면 `firestore.rules`가 프로젝트당 1개라 배포 시 bridge 규칙을 덮어쓸 위험, `firebase deploy --only functions`도 bridge 함수를 지우려 할 수 있음.
2. **밴드 PIN** — 유지할지, 추측 불가능한 밴드 링크(id)로 대체할지.
3. **이전 기간 중 핫픽스** — 밴드매니저에 남은 캐시 데이터 유실 버그(아래)를 meet 방식으로 먼저 고칠지.

## 핵심 사실

- meet은 band-manager 캘린더를 포크한 것. 서버 함수 `open_`, `put_`, `parseHours_`, `parseWindows_`, `doGet` 거의 동일.
- 응답 데이터 형태 동일: `{이름:{날짜:[시간...]}}`, `[]` = 그날 불가, 키 없음 = 미정. 시트에는 `"10,11,12"` / `"-"` / 행 없음.
- 저장 payload 동일: `{hours:{date:[..]|[]|null}, notes:{date:txt}}` (null = 행 삭제).
- 최적 시간 알고리즘 동일: `availAt ≥ T`인 연속 2시간 이상 구간, 인원→길이→날짜 순 정렬 (BM `index.html:1960-1974`, MT `index.html:2234-2248`).
- 둘 다 **실시간 없음**(폴링·visibilitychange 없음). 왕복 2~5초, 콜드스타트 10~15초.

### ⚠️ 밴드매니저의 살아있는 버그 (stale cache write-back)

- `band-manager/apps-script.gs:114` 에서 캐시 히트를 `_TOUCH`에 기록 → `load` 끝(`:459`)에서 `touchFlush_()`(`:66-72`)가 읽었던 값을 다시 캐시에 씀.
- 다른 사람 쓰기와 겹치면 옛 탭 내용이 캐시에 복원 → 다음 쓰기가 그 캐시로 **탭 전체를 재작성**(`put_` `:195-220`) → 남의 응답 삭제.
- meet는 v9(2026-09-22)에서 수정: `touchFlush_`를 no-op으로(`meet/apps-script.gs:61-70`), `warm()`이 락을 잡음(`:85-97`).
- 그 외: ScriptCache 값 100KB 한도 초과 시 try/catch 없어 요청 전체가 throw (BM `:171,:216`).

## 기능 비교

| | 밴드매니저 (BM) | 약속 잡자 (MT) |
|---|---|---|
| 범위 키 | 밴드(장기 그룹) | 약속(링크 1개 = 이벤트 1개) |
| 시간표 | 밴드당 여러 개 (`tid~date` 키) | 약속당 1개 |
| 멤버 | 관리자가 등록 | 이름 입력으로 자가 참여, save 시 자동 추가 |
| 저장 | 1.2초 디바운스 자동저장 | 모달 닫을 때/저장 버튼, 빈 저장 방지, 전체 미정 전환 시 확인 |
| 결과 | "합주 잡기" → 이력 행 | picks 후보 목록 + fixed 확정 |
| 셀 표시 | 구간 텍스트, ✗, — | ○ / △ / ✕ / – , 미입력 칸 깜빡임 |
| 접근 | 선택적 PIN(평문, URL 쿼리) | 없음. `meet_all`이 전체 약속 목록 노출 |
| BM만 | 여러 밴드, PIN, 합주곡(상태·투표·파트·링크·튜닝), 합주 이력(불참 사유, 연주곡, NEW 표시), 날짜 범위 일괄 추가, 백업 복원 | |
| MT만 | | 링크로 약속 생성, 친구 추가, 후보/확정, 내 달력 보기, 저장 로그(기록 탭), 인앱브라우저 탈출, Web Share, 안드로이드 뒤로가기로 모달 닫기, IME 안전 Enter, 제목 중복 검사, 관리자 일괄 삭제 |

## 밴드매니저 데이터 모델 (시트, `apps-script.gs:5-22`)

- 밴드(id|이름), 멤버(밴드|이름), 설정(밴드|key|value: dates, hourStart, hourEnd, title, windows, tables, pin)
- 응답(밴드|이름|날짜|시간), 메모(밴드|이름|날짜|메모), 수정(밴드|이름|시각)
- 곡(id|밴드|상태|제목|아티스트|키|선곡자|링크|파트|튜닝|메모|추가일)
- 이력(id|밴드|날짜|시작|종료|합주실|룸|상태|불참|곡|메모), 투표(밴드|곡|이름|값)
- 액션: load, band_add/rename/remove, member_add/rename/remove, config_set, save, reset_answers, song_save/status/remove, hist_save/remove, vote_set, bulk_import

## 약속 잡자 데이터 모델 (`apps-script.gs:7-31`)

- 약속(id|제목|장소|메모|시작|종료|확정|만든이|만든날), 설정(약속|key|value: dates, windows, picks)
- 참여, 응답, 메모, 수정(BM과 동일 구조), 기록(시각|약속|이름|내용, append-only)
- 액션: load, meet_info, meet_all, meet_new, meet_remove_many, meet_set, member_add/rename/remove, save, meet_remove, reset_answers

## 제안 Firestore 모델

```
meets/{meetId}                 title, place, memo, fixed, dates[], hourStart, hourEnd,
                               windows{}, picks[], owner, createdAt, updatedAt
meets/{meetId}/people/{pid}    name, hours{date:[h]}, notes{date:txt}, editedAt
meets/{meetId}/log/{autoId}    (선택) 저장 기록

bands/{bandId}                 name, members[], tables[{id,name,dates,hs,he}], windows{}, ...
bands/{bandId}/people/{pid}    name, hours{key:[h]}, notes{key:txt}, editedAt
bands/{bandId}/songs/{songId}  status, title, artist, key, picker, links, parts, tuning, memo, votes{name:v}
bands/{bandId}/sessions/{id}   date, from, to, place, room, status, absent[], songs[], memo
```

- 사람별 문서로 나눠서 **각자 자기 문서만 쓰기** → 동시 수정 충돌 제거.
- `onSnapshot`으로 실시간 반영.
- 목록 조회(`meet_all`)는 규칙으로 막고, 내 최근 약속은 localStorage로 유지.

## bridge의 Firebase 설정 (재사용 참고)

- 프로젝트 `benny-meeting`, Hosting 없음(GitHub Pages), Functions는 `asia-northeast3`, Node 22.
- SDK: gstatic CDN **compat 10.12.2** (`firebase-app/firestore/auth/app-check-compat.js`).
- 익명 로그인(`signInAnonymously`, 3회 재시도) + App Check(reCAPTCHA v3).
- 규칙 패턴: 특정 경로만 `request.auth != null` 허용 + 마지막에 `match /{document=**} { allow read, write: if false; }`.
- 쓰기는 `runTransaction`, 읽기는 `onSnapshot`. 단, bridge는 문서 1개(`app/state`)에 전부 넣는 구조라 여기엔 부적합 → 위 모델처럼 문서 분리.

## 약속 잡자 디자인이 깔끔한 이유 (이식 대상)

- 초록빛 회색 중립색 + 에메랄드 강조색 (`meet/index.html:9-22`)
  ```css
  --bg:#f5f7f6; --card:#fff; --line:#e4e9e6; --ink:#16211c; --muted:#6b7a72;
  --accent:#0b835b; --soft:#eef4f1;
  ```
- 제목 800~900 굵기, 큰 제목 22px `letter-spacing:-.045em` (`:476`)
- 카드 radius 18, 버튼 radius 12, `.btn.soft`처럼 강조색을 옅은 배경(.08~.10)으로 사용 (`:413-420`)
- 입력칸 16px / min-height 48px → iOS 확대 없음 (`:398-401`). BM은 14px라 확대됨
- 모달이 가운데 고정 높이(header/body/footer) (`:201-223`). BM은 바텀시트
- ○△✕ 기호 표시, 내 미입력 칸만 `breathe` 애니메이션 (`:491-510`)
- 시간 선택이 6열 타일 그리드 (`:243-247`)
- 정리할 것: BM에서 넘어온 죽은 CSS(`:535-621`), 중복 규칙, 모달 배경 클릭 핸들러 중복으로 `closeModal`이 두 번 불릴 수 있음(`:2831-2836`)

## 작업 순서 제안

1. (선택) BM 캐시 버그 핫픽스 — meet v9 방식 이식
2. 약속 잡자 v2: Firestore + 실시간, `meet_all` 제거, 버그/죽은 코드 정리, 보완(확정 후 캘린더 추가, 다크모드, 카카오 공유 등)
3. 공통 일정 모듈 분리 → 밴드매니저 캘린더 탭을 약속 잡자 UI로 교체
4. 합주곡·이력 탭을 같은 디자인으로 재작성, Firestore 서브컬렉션으로 이전
5. 기존 시트 데이터 이전: 현재 `load` 응답을 JSON으로 받아 Firestore에 import → 검증 후 전환

## PC 세션 시작 시 할 일

1. `secretary` 폴더에서 UI 참고 자료 확인
2. 위 미결정 사항 3개 사용자에게 확인
3. 로컬에 `band-manager`, `meet`, `bridge` 클론 (없으면)
