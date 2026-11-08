---
title: "유리스마스쿨 디자인 기준 (예약·수업일지 화면용)"
source: "https://yurismaschool.com"
extracted: 2026-11-08
method: "브라우저에서 실제로 그려진 화면의 계산된 스타일을 직접 읽음 (Dembrandt 방식과 같은 원리, Dembrandt 도구 자체는 실행하지 못함)"
colors:
  primary: "#4395EB"        # 선택된 버튼·강조 (추천순 버튼 배경)
  primary-deep: "#2D7DD2"   # 강조 글자·링크
  primary-tint: "#E1F3FE"   # 연한 파랑 배경
  ink: "#1A1815"            # 본문 진한 글자
  body: "#374151"
  muted: "#6B7280"          # 보조 글자·선택 안 된 탭
  surface: "#FFFFFF"
  soft: "#F8F9FA"           # 카드·칩 배경
  page: "#FAF9F5"           # 페이지 배경
  border: "#EAEAEA"
  tag: "#8B5CF6"            # 보라 배지
  danger: "#DC2626"
  danger-tint: "#FEF2F2"
typography:
  family: "\"Pretendard Variable\", Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
  hero: "72px / 900"
  title: "18px / 700"
  body: "16px / 500"
  nav: "15px / 600"
  small: "13px / 500"
  badge: "11px / 700~800, 10.5px / 700"
radius:
  pill: "999px"   # 버튼·칩·탭 대부분
  card: "14px"
  round: "50%"
shadow:
  banner: "0 2px 10px rgba(0,0,0,0.12)"
spacing:
  gaps: [4, 6, 8, 10, 16]
  pill-padding: "7px 13px"
  tab-padding: "16px 8px"
---

# 유리스마스쿨 디자인 기준

예약·회원·수업일지 화면을 유리스마스쿨 사이트와 같은 느낌으로 맞추기 위한 기준이다. 2026-11-08 유리스마스쿨 첫 화면(로그인 상태, PC 폭과 390px 휴대폰 폭)에서 실제로 그려진 값을 읽었다.

## 1. 색
- 기본 강조색은 파랑 `#4395EB` 하나다. 선택된 버튼, 저장 버튼, 진행 표시에만 쓴다.
- 글자는 진한 `#1A1815`, 보조 글자는 회색 `#6B7280`.
- 배경은 흰색 카드 + 아주 연한 회색 `#F8F9FA` 칩. 테두리는 `#EAEAEA` 한 가지.
- 빨강 `#DC2626`은 취소·삭제·기한 지남에만 쓴다.

## 2. 글꼴
- Pretendard 하나만 쓴다. 굵기로 위계를 만든다(본문 500, 제목 700, 큰 제목 900).
- 작은 배지는 11px 굵게.

## 3. 모양
- 버튼·칩·탭은 거의 모두 알약 모양(`999px`). 카드는 `14px` 둥근 모서리.
- 그림자는 배너에만 약하게. 카드는 그림자 대신 테두리.

## 4. 화면 규칙 (예약·수업일지에 적용)
- 선택된 항목 = 파랑 배경 + 흰 글자, 선택 안 된 항목 = 연회색 배경 + 회색 글자 (사이트의 정렬 버튼과 같음).
- 한 화면에서 파랑 꽉 찬 버튼은 하나(가장 중요한 행동)만.
- 휴대폰 폭 390px 기준으로 먼저 맞춘다.

## 5. 참고와 한계
- 사이트 CSS에는 첫 화면에서 쓰이지 않는 색 변수(보라 계열 `--p-accent #a35c9b`, 주황 `--accent #ce8e42` 등)도 선언돼 있다. 다른 페이지에서 쓰일 수 있어 `검증 필요`.
- 공식 Dembrandt 결과와 비교하려면 PC 터미널에서 다음을 실행한다(설치는 별도 승인 후).
  - `npm install -g dembrandt`
  - `dembrandt install-browser`
  - `dembrandt yurismaschool.com --design-md --mobile`
