# Live curl test (temporary) — tokens read from %TEMP%\mf_a.tok / mf_b.tok
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$API = 'https://lesp7s1im6.execute-api.ap-southeast-1.amazonaws.com'
$TOK = @{ a = (Get-Content -Raw "$env:TEMP\mf_a.tok"); b = (Get-Content -Raw "$env:TEMP\mf_b.tok") }
$script:pass = 0; $script:fail = 0

function Req($who, $method, $path, $body = $null, [string[]]$extra = @()) {
  $args = @('-s', '-o', "$env:TEMP\mf_body.txt", '-w', '%{http_code}', '-X', $method, "$API$path")
  if ($who) { $args += @('-H', "authorization: Bearer $($TOK[$who])") }
  if ($null -ne $body) {
    [IO.File]::WriteAllText("$env:TEMP\mf_req.json", ($body | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
    $args += @('-H', 'content-type: application/json', '--data-binary', "@$env:TEMP\mf_req.json")
  }
  $args += $extra
  $status = [int](& curl.exe @args)
  $raw = [IO.File]::ReadAllText("$env:TEMP\mf_body.txt", [Text.Encoding]::UTF8)
  $json = $null; try { $json = $raw | ConvertFrom-Json } catch {}
  [pscustomobject]@{ Status = $status; Raw = $raw; Json = $json }
}
function Check($name, [bool]$ok, $detail = '') {
  if ($ok) { $script:pass++; "PASS  $name" } else { $script:fail++; "FAIL  $name  $detail" }
}
$today = (Get-Date).ToString('yyyy-MM-dd')
$month = $today.Substring(0, 7)

# --- auth ---
$r = Req $null GET '/summary/balance'
Check 'ไม่มี token -> 401' ($r.Status -eq 401) $r.Raw
$r = Req $null GET '/summary/balance' $null @('-H', 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.x')
Check 'token ปลอม -> 401' ($r.Status -eq 401) $r.Raw

# --- create + idempotency ---
$key = [guid]::NewGuid().ToString()
$tx = @{ description = 'ข้าวมันไก่'; amount = 50; type = 'expense'; category = 'อาหาร'; transactionDate = $today; clientTimezone = 'Asia/Bangkok'; idempotencyKey = $key }
$r1 = Req a POST '/transactions' $tx
Check 'POST /transactions -> 201' ($r1.Status -eq 201) $r1.Raw
$id = $r1.Json.id
Check 'ภาษาไทยไป-กลับถูกต้อง' ($r1.Json.description -eq 'ข้าวมันไก่') $r1.Json.description
$r2 = Req a POST '/transactions' $tx
Check 'ส่งซ้ำ key เดิม -> 200 id เดิม' ($r2.Status -eq 200 -and $r2.Json.id -eq $id) "$($r2.Status) $($r2.Raw)"
$tx2 = $tx.Clone(); $tx2.amount = 999
$r = Req a POST '/transactions' $tx2
Check 'key เดิมข้อมูลต่าง -> 409 IDEMPOTENCY_CONFLICT' ($r.Status -eq 409 -and $r.Json.code -eq 'IDEMPOTENCY_CONFLICT') $r.Raw
$r = Req a POST '/transactions' (@{ description = 'x'; amount = 10.5; type = 'expense'; transactionDate = $today; idempotencyKey = [guid]::NewGuid().ToString() })
Check 'ทศนิยม -> 400 ข้อความไทย' ($r.Status -eq 400 -and $r.Json.message -like '*จำนวนเต็ม*') $r.Raw
$r = Req a POST '/transactions' (@{ description = 'x'; amount = 1; type = 'expense'; transactionDate = $today; idempotencyKey = [guid]::NewGuid().ToString(); userId = 'hacker' })
Check 'ส่ง userId ใน body -> 400' ($r.Status -eq 400) $r.Raw
$income = @{ description = 'เงินเดือน'; amount = 17000; type = 'income'; category = 'เงินเดือน'; transactionDate = $today; idempotencyKey = [guid]::NewGuid().ToString() }
$r = Req a POST '/transactions' $income
Check 'POST รายรับ -> 201' ($r.Status -eq 201) $r.Raw

# --- summary ---
$r = Req a GET '/summary/balance'
Check 'balance = 17000 - 50' ($r.Json.balance -eq 16950 -and $r.Json.transactionCount -eq 2) $r.Raw
$r = Req a GET "/summary/monthly?month=$month"
Check 'monthly: อาหาร อยู่อันดับแรกของรายจ่าย' ($r.Json.expense -eq 50 -and $r.Json.byCategory[0].category -eq 'อาหาร') $r.Raw

# --- patch ---
$r = Req a PATCH "/transactions/$id" @{ amount = 80 }
Check 'PATCH amount -> 200' ($r.Status -eq 200 -and $r.Json.amount -eq 80) $r.Raw
$r = Req a PATCH "/transactions/$id" @{ idempotencyKey = [guid]::NewGuid().ToString() }
Check 'PATCH idempotencyKey -> 400' ($r.Status -eq 400) $r.Raw
$r = Req a GET '/summary/balance'
Check 'balance หลังแก้ = 16920' ($r.Json.balance -eq 16920) $r.Raw

# --- isolation: user B ---
$r = Req b GET '/transactions'
Check 'B list -> ไม่เห็นของ A' ($r.Status -eq 200 -and $r.Json.items.Count -eq 0) $r.Raw
$r = Req b PATCH "/transactions/$id" @{ amount = 1 }
Check 'B PATCH ของ A -> 404' ($r.Status -eq 404 -and $r.Json.code -eq 'NOT_FOUND') $r.Raw
$r = Req b DELETE "/transactions/$id"
Check 'B DELETE ของ A -> 404' ($r.Status -eq 404) $r.Raw
$r = Req b POST "/transactions/$id/restore"
Check 'B restore ของ A -> 404' ($r.Status -eq 404) $r.Raw
$r = Req b POST '/transactions/bulk-delete' @{ ids = @($id) }
Check 'B bulk-delete ของ A -> notFound' ($r.Status -eq 200 -and $r.Json.deleted.Count -eq 0) $r.Raw
$r = Req b GET '/summary/balance'
Check 'B balance = 0' ($r.Json.balance -eq 0) $r.Raw
$r = Req a GET '/summary/balance'
Check 'A ไม่ถูกกระทบจาก B' ($r.Json.balance -eq 16920) $r.Raw

# --- soft delete / restore ---
$r = Req a DELETE "/transactions/$id"
Check 'DELETE -> 200 มี deletedAt' ($r.Status -eq 200 -and $r.Json.deletedAt) $r.Raw
$r = Req a GET '/summary/balance'
Check 'balance หลังลบ = 17000' ($r.Json.balance -eq 17000) $r.Raw
$r = Req a GET '/transactions'
Check 'list ไม่รวมรายการที่ลบ' ($r.Json.items.Count -eq 1) $r.Raw
$r = Req a POST "/transactions/$id/restore"
Check 'restore -> 200' ($r.Status -eq 200 -and $null -eq $r.Json.deletedAt) $r.Raw
$r = Req a GET '/summary/balance'
Check 'balance หลังกู้คืน = 16920' ($r.Json.balance -eq 16920) $r.Raw

# --- pagination ---
foreach ($i in 1..3) { $null = Req a POST '/transactions' @{ description = "ชา $i"; amount = $i; type = 'expense'; category = 'เดินทาง'; transactionDate = $today; idempotencyKey = [guid]::NewGuid().ToString() } }
$p1 = Req a GET '/transactions?limit=2'
$p2 = Req a GET "/transactions?limit=2&cursor=$($p1.Json.nextCursor)"
$p3 = Req a GET "/transactions?limit=2&cursor=$($p2.Json.nextCursor)"
$all = @($p1.Json.items) + @($p2.Json.items) + @($p3.Json.items)
Check 'paginate cursor: 5 รายการไม่ซ้ำ' ($all.Count -eq 5 -and ($all.id | Sort-Object -Unique).Count -eq 5 -and $null -eq $p3.Json.nextCursor) "$($all.Count)"

# --- bulk delete ---
$ids = @($all | Where-Object { $_.description -like 'ชา*' } | ForEach-Object { $_.id })
$r = Req a POST '/transactions/bulk-delete' @{ ids = $ids }
Check 'bulk-delete 3 รายการ' ($r.Status -eq 200 -and $r.Json.deleted.Count -eq 3) $r.Raw

# --- settings / achievements / export ---
$r = Req a GET '/settings'
Check 'GET settings default 17000' ($r.Json.monthlySalary -eq 17000) $r.Raw
$r = Req a PUT '/settings' @{ monthlySalary = 25000; categoryBudgets = @(@{ category = 'เดินทาง'; budget = 1500 }, @{ category = 'อาหาร'; budget = 6000 }) }
Check 'PUT settings, อาหาร มาก่อน' ($r.Status -eq 200 -and $r.Json.categoryBudgets[0].category -eq 'อาหาร') $r.Raw
$r = Req a POST '/achievements' @{ badgeId = 'first-tx' }
Check 'POST achievement -> 201' ($r.Status -eq 201) $r.Raw
$r = Req a POST '/achievements' @{ badgeId = 'first-tx' }
Check 'achievement ซ้ำ -> 200' ($r.Status -eq 200) $r.Raw
$r = Req a DELETE '/achievements?badgeId=first-tx'
Check 'DELETE achievement -> 204' ($r.Status -eq 204) $r.Raw
$r = Req a GET '/export?format=csv'
Check 'export CSV มี BOM + ภาษาไทย' ($r.Status -eq 200 -and $r.Raw.Contains('ข้าวมันไก่')) $r.Raw.Substring(0, [Math]::Min(80, $r.Raw.Length))
$r = Req b GET '/export?format=json'
Check 'export ของ B ไม่มีข้อมูล A' ($r.Status -eq 200 -and $r.Json.transactions.Count -eq 0) $r.Raw

# --- CORS ---
$h = & curl.exe -s -i -X OPTIONS "$API/transactions" -H 'origin: http://localhost:5173' -H 'access-control-request-method: POST' -H 'access-control-request-headers: authorization,content-type'
Check 'CORS preflight localhost:5173 อนุญาต' (($h -join "`n") -match 'access-control-allow-origin: http://localhost:5173')
$h = & curl.exe -s -i -X OPTIONS "$API/transactions" -H 'origin: https://evil.example.com' -H 'access-control-request-method: POST'
Check 'CORS preflight โดเมนอื่น ไม่อนุญาต' (-not (($h -join "`n") -match 'access-control-allow-origin'))

# --- error format: no stack ---
$r = Req a GET '/summary/monthly?month=bad'
Check 'error เป็น {code,message} ไม่มี stack' ($r.Status -eq 400 -and $r.Json.code -and -not $r.Raw.Contains(' at ')) $r.Raw

# --- account deletion (user B) ---
$null = Req b POST '/transactions' @{ description = 'ทดสอบลบบัญชี'; amount = 5; type = 'expense'; transactionDate = $today; idempotencyKey = [guid]::NewGuid().ToString() }
$r = Req b DELETE '/account' @{ confirm = 'yes' }
Check 'DELETE /account ไม่ยืนยัน -> 400' ($r.Status -eq 400) $r.Raw
$r = Req b DELETE '/account' @{ confirm = 'ลบบัญชี' }
Check 'DELETE /account -> 200' ($r.Status -eq 200 -and $r.Json.deletedItems -ge 1) $r.Raw

"`n==> PASS=$script:pass FAIL=$script:fail"
