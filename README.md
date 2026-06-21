# 한손터치 (OneHandTouch)

한 손으로 폰을 잡았을 때 엄지가 닿지 않는 화면 위치를, 엄지가 닿는 곳에 떠 있는
**플로팅 버튼**으로 대신 눌러 주는 안드로이드 보조 앱입니다.

> 예) 화면 맨 위의 뒤로가기/메뉴 버튼, 반대편 모서리의 버튼 등을 미리 "지점"으로
> 저장해 두면, 플로팅 버튼에서 해당 지점을 눌러 그 위치를 자동으로 탭합니다.

## 동작 원리

- **다른 앱 위에 표시(SYSTEM_ALERT_WINDOW)** 권한으로 모든 앱 위에 떠 있는
  드래그 가능한 플로팅 버튼을 그립니다.
- **접근성 서비스(AccessibilityService.dispatchGesture)** 로 root 권한 없이
  지정한 화면 좌표를 실제로 탭합니다. (Android 7.0 / API 24 이상)

이 앱은 화면 내용을 읽거나 외부로 전송하지 않습니다. 접근성 권한은 오직 지정한
좌표를 탭하기 위해서만 사용합니다.

## 사용 방법

1. 앱을 실행하고 **1. 다른 앱 위에 표시** 권한을 허용합니다.
2. **2. 접근성 서비스** 설정을 열어 목록에서 "한손터치"를 켭니다.
3. **＋ 지점 추가** 를 눌러, 대신 눌러줄 화면 위치를 한 번 탭하고 이름을 정합니다.
   (여러 개 저장할 수 있습니다.)
4. **3. 플로팅 버튼 켜기** 를 누르면 화면에 동그란 버튼이 나타납니다.
5. 플로팅 버튼을 **드래그**해 엄지가 닿기 좋은 위치에 둡니다.
6. 버튼을 **탭**하면 저장한 지점 목록이 펼쳐지고, 항목을 누르면 그 위치가
   자동으로 눌립니다.

## 프로젝트 구조

```
app/src/main/java/com/onehandtouch/app/
├── MainActivity.kt                  # 권한 안내 · 서비스 토글 · 지점 관리 화면
├── FloatingService.kt               # 떠 있는 플로팅 버튼(오버레이) 포그라운드 서비스
├── AutoTouchAccessibilityService.kt # dispatchGesture 로 좌표를 탭하는 접근성 서비스
├── PointPickerActivity.kt           # 화면을 탭해 목표 좌표를 기록하는 반투명 화면
├── PointStore.kt                    # 지점 목록 저장/로드(SharedPreferences + JSON)
└── TouchPoint.kt                    # 지점 데이터 모델
```

## 빌드

### Android Studio
프로젝트를 열고 `Run` 하거나 `Build > Build APK(s)` 를 실행합니다.

### 명령줄
```bash
./gradlew assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```

### GitHub Actions
`main`/브랜치 푸시 또는 PR마다 `.github/workflows/build-apk.yml` 가 디버그 APK를
빌드해 아티팩트(`onehandtouch-debug-apk`)로 올립니다. Actions 실행 페이지에서
APK를 내려받을 수 있습니다.

## 요구 사항

- 최소 Android 7.0 (API 24)
- 컴파일/타깃 SDK 34
- JDK 17

## 한계 / 참고

- 접근성 제스처는 화면 절대 좌표 기준이므로, 화면 회전이나 해상도가 다른 기기
  사이에서는 지점을 다시 등록하는 것이 좋습니다.
- 일부 제조사 펌웨어는 백그라운드 접근성 서비스를 절전 정책으로 종료할 수
  있습니다. 배터리 최적화 예외로 두면 안정적입니다.
