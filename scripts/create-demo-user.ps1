# สร้าง/รีเซ็ตบัญชีทดลองที่ใช้ร่วมกัน (สำหรับ Portfolio) — รันซ้ำได้ (idempotent)
#   .\scripts\create-demo-user.ps1 -Email demo@moneyflow.app -Password 123456
# ต้องมี AWS CLI + สิทธิ์ cognito-idp:Admin* บน User Pool
# รันซ้ำเมื่อมีคนเปลี่ยนรหัสผ่านบัญชีทดลอง เพื่อตั้งกลับเป็นค่าเดิม
param(
  [Parameter(Mandatory)] [string]$Email,
  [Parameter(Mandatory)] [string]$Password,
  [string]$UserPoolId,
  [string]$Region = 'ap-southeast-1'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not $UserPoolId) {
  $outputs = Get-Content -Raw (Join-Path $PSScriptRoot '..\infra\cdk-outputs.json') | ConvertFrom-Json
  $UserPoolId = $outputs.'MoneyFlow-AuthStack'.ViteCognitoUserPoolId
}
if (-not $UserPoolId) { throw 'ไม่พบ UserPoolId: ระบุ -UserPoolId หรือ deploy ให้มี infra\cdk-outputs.json' }
$Email = $Email.Trim().ToLower()

# เรียก AWS CLI; คืน $true/$false ตาม exit code
# (PowerShell 5.1 + ErrorActionPreference=Stop จะถือ stderr ของ native command เป็น error จึงปิดชั่วคราว)
# หมายเหตุ: ห้ามตั้งชื่อฟังก์ชันว่า "Aws" — PowerShell ไม่สนตัวพิมพ์ จะเรียกตัวเองวนไม่จบ
function Invoke-AwsCli([string[]]$CliArgs, [switch]$AllowFail) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & aws.exe @CliArgs --region $Region 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0 -and -not $AllowFail) {
    throw "aws $($CliArgs[0..1] -join ' ') ล้มเหลว: $($out -join ' ')"
  }
  return ($code -eq 0)
}

$exists = Invoke-AwsCli @('cognito-idp', 'admin-get-user', '--user-pool-id', $UserPoolId,
  '--username', $Email) -AllowFail
if (-not $exists) {
  # SUPPRESS: ไม่ส่งอีเมลเชิญ; email_verified=true ให้ login ด้วยอีเมลได้
  Invoke-AwsCli @('cognito-idp', 'admin-create-user', '--user-pool-id', $UserPoolId,
    '--username', $Email, '--user-attributes', "Name=email,Value=$Email",
    'Name=email_verified,Value=true', '--message-action', 'SUPPRESS') | Out-Null
  "สร้างผู้ใช้ $Email แล้ว"
} else {
  "มีผู้ใช้ $Email อยู่แล้ว - รีเซ็ตรหัสผ่าน"
}

# --permanent: ไม่ต้องตั้งรหัสใหม่ตอน login ครั้งแรก
Invoke-AwsCli @('cognito-idp', 'admin-set-user-password', '--user-pool-id', $UserPoolId,
  '--username', $Email, '--password', $Password, '--permanent') | Out-Null
# group demo: API จะไม่ยอมให้ลบบัญชีนี้
Invoke-AwsCli @('cognito-idp', 'admin-add-user-to-group', '--user-pool-id', $UserPoolId,
  '--username', $Email, '--group-name', 'demo') | Out-Null

"พร้อมใช้: $Email (group: demo)"
"ใส่ใน web\.env.local และ GitHub repository variables:"
"  VITE_DEMO_EMAIL=$Email"
"  VITE_DEMO_PASSWORD=$Password"
