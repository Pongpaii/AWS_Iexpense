'use strict'
const COLORS = {
  user: 'var(--c-user)',
  auth: 'var(--c-auth)',
  data: 'var(--c-data)',
  ci: 'var(--c-ci)',
  cost: 'var(--c-cost)',
}

// พิกัดอยู่ในระบบ canvas 1440 × 1100
const CLOUD = { x: 240, y: 20, w: 1180, h: 970, label: 'AWS Cloud · ap-southeast-1' }

const GROUPS = [
  { x: 270, y: 70, w: 330, h: 290, name: 'MoneyFlow-WebStack', note: 'S3 + CloudFront' },
  { x: 270, y: 400, w: 330, h: 270, name: 'MoneyFlow-AuthStack', note: 'Cognito' },
  { x: 650, y: 70, w: 380, h: 520, name: 'MoneyFlow-ApiStack', note: 'HTTP API + Lambda' },
  { x: 1080, y: 240, w: 310, h: 180, name: 'MoneyFlow-DataStack', note: 'DynamoDB' },
  { x: 270, y: 720, w: 330, h: 250, name: 'MoneyFlow-CiStack', note: 'deploy ด้วยมือ' },
  { x: 650, y: 720, w: 380, h: 250, name: 'MoneyFlow-BudgetStack', note: 'ฟรี' },
  { x: 1080, y: 720, w: 310, h: 250, name: 'CDK Bootstrap', note: 'cdk bootstrap' },
  { x: 15, y: 90, w: 210, h: 320, name: 'Clients', external: true },
  { x: 15, y: 700, w: 210, h: 160, name: 'GitHub', external: true },
]

const NODES = [
  {
    id: 'browser',
    x: 30,
    y: 130,
    w: 180,
    h: 90,
    icon: 'WEB',
    color: 'var(--s-ext)',
    title: 'เว็บเบราว์เซอร์',
    sub: 'Vue SPA / PWA',
    stack: 'Client',
    details: [
      'โหลดหน้าเว็บจาก CloudFront',
      'Sign-in ด้วย <code>aws-amplify</code> (SRP) ตรงกับ Cognito',
      'เรียก HTTP API พร้อม header <code>Authorization: Bearer &lt;JWT&gt;</code>',
    ],
  },
  {
    id: 'android',
    x: 30,
    y: 300,
    w: 180,
    h: 90,
    icon: 'APK',
    color: 'var(--s-ext)',
    title: 'แอป Android',
    sub: 'Capacitor 8 (WebView)',
    stack: 'Client',
    details: [
      'origin เป็น <code>https://localhost</code> (อยู่ใน CORS allowlist)',
      'ใช้ Cognito + HTTP API ชุดเดียวกับเว็บ',
      'build ผ่าน workflow <code>android.yml</code> เป็น debug APK',
    ],
  },
  {
    id: 'github',
    x: 30,
    y: 740,
    w: 180,
    h: 100,
    icon: 'GH',
    color: '#24292f',
    title: 'GitHub Actions',
    sub: 'ci.yml · deploy.yml · android.yml',
    chips: ['id-token: write'],
    stack: 'CI/CD',
    details: [
      'push เข้า <code>main</code> → รัน ci แล้ว deploy (environment <code>production</code>)',
      'ขอ OIDC token แล้ว assume role <code>money-flow-github-deploy</code>',
      'ต้องตั้ง variable <code>AWS_DEPLOY_ROLE_ARN</code> และ secret <code>ALERT_EMAIL</code>',
    ],
  },
  {
    id: 'email',
    x: 700,
    y: 1020,
    w: 280,
    h: 62,
    icon: '@',
    color: 'var(--s-ext)',
    title: 'อีเมลแจ้งเตือน',
    sub: 'context alertEmail / ALERT_EMAIL',
    stack: 'External',
    details: ['ส่งจาก AWS Budgets และ Cost Anomaly Detection'],
  },
  {
    id: 'cloudfront',
    x: 300,
    y: 115,
    w: 270,
    h: 100,
    icon: 'CF',
    color: 'var(--s-network)',
    title: 'CloudFront',
    sub: 'Distribution · PriceClass 200',
    chips: ['HTTP/2+3', 'TLS 1.2', 'SPA rewrite fn', 'Security headers'],
    stack: 'MoneyFlow-WebStack',
    details: [
      'Viewer: redirect HTTP → HTTPS, IPv6, compress',
      'Default behavior: <code>CACHING_DISABLED</code> + <code>Cache-Control: no-cache</code> (index.html, sw.js)',
      '<code>/assets/*</code>: cache 365 วัน, <code>immutable</code>, gzip + brotli',
      'CloudFront Function (viewer-request): path ที่ไม่มีนามสกุล → <code>/index.html</code>',
      'Response headers: CSP, HSTS (1 ปี, preload), X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP',
      'ไม่เปิด access log / WAF (ประหยัดค่าใช้จ่าย)',
    ],
  },
  {
    id: 's3',
    x: 300,
    y: 265,
    w: 270,
    h: 85,
    icon: 'S3',
    color: 'var(--s-storage)',
    title: 'S3 Bucket',
    sub: 'private · เข้าผ่าน OAC เท่านั้น',
    chips: ['BPA', 'SSE-S3', 'enforceSSL'],
    stack: 'MoneyFlow-WebStack',
    details: [
      'ชื่อ bucket: <code>money-flow-web-&lt;account&gt;-&lt;region&gt;</code>',
      'Private bucket — อ่านได้เฉพาะ CloudFront ผ่าน Origin Access Control',
      'Object ownership: BucketOwnerEnforced, ไม่เปิด versioning',
      'RemovalPolicy DESTROY (ต้องลบไฟล์ก่อน destroy)',
    ],
  },
  {
    id: 'cognito',
    x: 300,
    y: 445,
    w: 270,
    h: 100,
    icon: 'COG',
    color: 'var(--s-security)',
    title: 'Cognito User Pool',
    sub: 'money-flow-users · Lite plan',
    chips: ['sign-in: email', 'SRP client', 'group: demo'],
    stack: 'MoneyFlow-AuthStack',
    details: [
      'Self sign-up เปิด, MFA ปิด, password ขั้นต่ำ 6 ตัว (แอป demo)',
      'App client <code>money-flow-web</code>: ไม่มี secret, เฉพาะ USER_SRP_AUTH, ไม่มี OAuth/Hosted UI',
      'Access/ID token 1 ชม., refresh token 30 วัน, token revocation เปิด',
      'Group <code>demo</code> = บัญชีทดลองที่ API ห้ามลบ',
      'อีเมลส่งผ่าน Cognito default (~50 ฉบับ/วัน)',
      'retainData=true → deletion protection + RETAIN',
    ],
  },
  {
    id: 'presignup',
    x: 300,
    y: 580,
    w: 270,
    h: 70,
    icon: 'λ',
    color: 'var(--s-compute)',
    title: 'Lambda PreSignUp',
    sub: 'money-flow-presignup (inline)',
    stack: 'MoneyFlow-AuthStack',
    details: [
      'ตั้ง <code>autoConfirmUser = true</code> → สมัครแล้วใช้งานได้ทันที',
      'ไม่ auto-verify อีเมล (กันการใช้ "ลืมรหัสผ่าน" ส่งไปอีเมลคนอื่น)',
      'Node.js 22, arm64, 256 MB, timeout 10s',
    ],
  },
  {
    id: 'httpapi',
    x: 680,
    y: 115,
    w: 320,
    h: 110,
    icon: 'API',
    color: 'var(--s-mgmt)',
    title: 'API Gateway HTTP API',
    sub: 'money-flow-api · stage $default',
    chips: ['Cognito JWT authorizer', 'throttle 20 rps / burst 40', 'CORS', 'access logs'],
    stack: 'MoneyFlow-ApiStack',
    details: [
      'Default authorizer: <code>HttpUserPoolAuthorizer</code> ตรวจ JWT ของ app client',
      'CORS origins: โดเมน CloudFront (<code>webOrigin</code>), <code>http://localhost:5173</code>, <code>https://localhost</code>',
      'Routes → Api Lambda: <code>/transactions</code> (GET, POST, PATCH, DELETE, restore, bulk-delete), <code>/summary/balance</code>, <code>/summary/monthly</code>, <code>/settings</code>, <code>/achievements</code>, <code>/export</code>',
      'Route → Account Lambda: <code>DELETE /account</code>',
      'Access log: <code>/aws/apigateway/money-flow-api</code>',
    ],
  },
  {
    id: 'lambdaAccount',
    x: 680,
    y: 300,
    w: 150,
    h: 100,
    icon: 'λ',
    color: 'var(--s-compute)',
    title: 'Account Fn',
    sub: 'money-flow-account',
    chips: ['account.ts'],
    stack: 'MoneyFlow-ApiStack',
    details: [
      'ลบข้อมูลทั้งหมดของผู้ใช้ใน DynamoDB แล้วลบ user ใน Cognito',
      'IAM: DynamoDB read/write + <code>cognito-idp:AdminDeleteUser</code> (เฉพาะ user pool นี้)',
      'env: <code>TABLE_NAME</code>, <code>USER_POOL_ID</code>',
    ],
  },
  {
    id: 'lambdaApi',
    x: 850,
    y: 300,
    w: 150,
    h: 100,
    icon: 'λ',
    color: 'var(--s-compute)',
    title: 'Api Fn',
    sub: 'money-flow-api',
    chips: ['api.ts'],
    stack: 'MoneyFlow-ApiStack',
    details: [
      'Lambda เดียวรับ 14 routes (transactions, summary, settings, achievements, export)',
      'Node.js 22 · arm64 · 256 MB · 10s · ไม่อยู่ใน VPC',
      'esbuild ESM + minify + source map, ใช้ AWS SDK v3 ของ runtime',
      'IAM: DynamoDB read/write บนตาราง MoneyFlow',
      'JSON logs (app INFO / system WARN)',
    ],
  },
  {
    id: 'logs',
    x: 680,
    y: 480,
    w: 320,
    h: 75,
    icon: 'CW',
    color: 'var(--s-mgmt)',
    title: 'CloudWatch Logs',
    sub: 'retention 7 วัน ทุก log group',
    chips: ['/aws/lambda/money-flow-*', '/aws/apigateway/money-flow-api'],
    stack: 'MoneyFlow-ApiStack / AuthStack',
    details: [
      'Log group ของ Lambda ทั้ง 3 ตัว และ access log ของ API',
      'RemovalPolicy DESTROY, retention 7 วัน (บังคับโดย cost guard)',
    ],
  },
  {
    id: 'dynamodb',
    x: 1110,
    y: 285,
    w: 250,
    h: 110,
    icon: 'DDB',
    color: 'var(--s-database)',
    title: 'DynamoDB',
    sub: 'table MoneyFlow (single-table)',
    chips: ['PK / SK', 'on-demand', 'ไม่มี GSI'],
    stack: 'MoneyFlow-DataStack',
    details: [
      '<code>PK = USER#&lt;sub&gt;</code>',
      '<code>SK = TX#&lt;date&gt;#&lt;ulid&gt; | TXID#&lt;ulid&gt; | IDEMP#&lt;uuid&gt; | SUM#&lt;yyyy-mm&gt; | SUM#ALL | SETTINGS | BADGE#&lt;id&gt;</code>',
      'ทุก access pattern อยู่ใน partition ของ user',
      'Encryption: AWS-owned key (ฟรี)',
      'PITR ปิดเป็นค่าเริ่มต้น (<code>enablePitr</code>), deletion protection ตาม <code>retainData</code>',
    ],
  },
  {
    id: 'iamrole',
    x: 300,
    y: 765,
    w: 270,
    h: 80,
    icon: 'IAM',
    color: 'var(--s-security)',
    title: 'IAM Role',
    sub: 'money-flow-github-deploy',
    chips: ['session ≤ 1h', 's3 sync + CF invalidate'],
    stack: 'MoneyFlow-CiStack',
    details: [
      'Trust: เฉพาะ <code>repo:Pongpaii/AWS_Iexpense:ref:refs/heads/main</code>',
      '<code>sts:AssumeRole</code> เฉพาะ role <code>cdk-hnb659fds-*</code>',
      '<code>cloudformation:DescribeStacks</code> เฉพาะ stack <code>MoneyFlow-*</code>',
      'S3 List/Put/Get/Delete เฉพาะ bucket เว็บ',
      '<code>cloudfront:CreateInvalidation</code>',
    ],
  },
  {
    id: 'oidc',
    x: 300,
    y: 865,
    w: 270,
    h: 75,
    icon: 'ID',
    color: 'var(--s-security)',
    title: 'GitHub OIDC Provider',
    sub: 'token.actions.githubusercontent.com',
    stack: 'MoneyFlow-CiStack',
    details: [
      'audience <code>sts.amazonaws.com</code>',
      'ใช้ provider เดิมได้ผ่าน <code>githubOidcProviderArn</code> (1 บัญชีมีได้ 1 ตัว)',
    ],
  },
  {
    id: 'budgets',
    x: 680,
    y: 765,
    w: 320,
    h: 75,
    icon: '$',
    color: 'var(--s-mgmt)',
    title: 'AWS Budgets',
    sub: 'money-flow-monthly · $20/เดือน',
    chips: ['actual > $1 / $5 / $20', 'forecast > $10'],
    stack: 'MoneyFlow-BudgetStack',
    details: ['ครอบคลุมทั้งบัญชี (ไม่กรองด้วย tag)', 'ไม่รวม credit / refund', 'แจ้งเตือนทางอีเมล'],
  },
  {
    id: 'anomaly',
    x: 680,
    y: 865,
    w: 320,
    h: 80,
    icon: 'CE',
    color: 'var(--s-mgmt)',
    title: 'Cost Anomaly Detection',
    sub: 'monitor: SERVICE · daily',
    chips: ['impact ≥ $1'],
    stack: 'MoneyFlow-BudgetStack',
    details: [
      'สร้าง monitor ใหม่ หรือใช้ของเดิมผ่าน <code>anomalyMonitorArn</code>',
      'Subscription รายวัน ส่งอีเมลเมื่อผลกระทบรวม ≥ $1',
    ],
  },
  {
    id: 'cfn',
    x: 1110,
    y: 775,
    w: 250,
    h: 90,
    icon: 'CFN',
    color: 'var(--s-mgmt)',
    title: 'CloudFormation',
    sub: 'CDK bootstrap roles cdk-hnb659fds-*',
    chips: ['cdk deploy'],
    stack: 'CDK Bootstrap',
    details: [
      'CI assume bootstrap roles แล้วให้ CloudFormation สร้าง/อัปเดต stack',
      'Deploy: Budget, Auth, Data, Api, Web (CiStack ไม่ถูก deploy โดย CI)',
    ],
  },
]

// points = polyline ในพิกัด canvas (ลูกศรอยู่ที่ปลาย)
const EDGES = [
  {
    from: 'browser',
    to: 'cloudfront',
    type: 'user',
    label: 'HTTPS',
    points: [
      [210, 160],
      [300, 160],
    ],
  },
  {
    from: 'browser',
    to: 'httpapi',
    type: 'user',
    label: 'REST + JWT (Bearer)',
    points: [
      [120, 130],
      [120, 45],
      [840, 45],
      [840, 115],
    ],
  },
  {
    from: 'browser',
    to: 'cognito',
    type: 'auth',
    label: 'SRP sign-in',
    points: [
      [210, 200],
      [228, 200],
      [228, 480],
      [300, 480],
    ],
    labelAt: [228, 255],
  },
  {
    from: 'android',
    to: 'httpapi',
    type: 'user',
    label: 'REST + JWT',
    points: [
      [210, 372],
      [640, 372],
      [640, 200],
      [680, 200],
    ],
    labelAt: [430, 372],
  },
  {
    from: 'android',
    to: 'cognito',
    type: 'auth',
    label: '',
    points: [
      [210, 385],
      [252, 385],
      [252, 515],
      [300, 515],
    ],
  },
  {
    from: 'cloudfront',
    to: 's3',
    type: 'user',
    label: 'OAC',
    points: [
      [435, 215],
      [435, 265],
    ],
  },
  {
    from: 'cognito',
    to: 'presignup',
    type: 'auth',
    label: 'trigger',
    points: [
      [435, 545],
      [435, 580],
    ],
  },
  {
    from: 'httpapi',
    to: 'lambdaAccount',
    type: 'user',
    label: 'DELETE /account',
    points: [
      [755, 225],
      [755, 300],
    ],
  },
  {
    from: 'httpapi',
    to: 'lambdaApi',
    type: 'user',
    label: '14 routes',
    points: [
      [925, 225],
      [925, 300],
    ],
  },
  {
    from: 'lambdaApi',
    to: 'dynamodb',
    type: 'data',
    label: 'Read / Write',
    points: [
      [1000, 340],
      [1110, 340],
    ],
    labelAt: [1055, 340],
  },
  {
    from: 'lambdaAccount',
    to: 'dynamodb',
    type: 'data',
    label: 'ลบข้อมูล user',
    points: [
      [790, 400],
      [790, 455],
      [1060, 455],
      [1060, 375],
      [1110, 375],
    ],
    labelAt: [925, 455],
  },
  {
    from: 'lambdaAccount',
    to: 'cognito',
    type: 'auth',
    label: 'AdminDeleteUser',
    points: [
      [720, 400],
      [720, 435],
      [620, 435],
      [620, 525],
      [570, 525],
    ],
    labelAt: [670, 435],
  },
  {
    from: 'github',
    to: 'iamrole',
    type: 'ci',
    label: 'OIDC',
    points: [
      [210, 800],
      [300, 800],
    ],
  },
  {
    from: 'oidc',
    to: 'iamrole',
    type: 'ci',
    label: 'trust',
    dashed: true,
    points: [
      [435, 865],
      [435, 845],
    ],
    labelAt: [480, 855],
  },
  {
    from: 'iamrole',
    to: 'cfn',
    type: 'ci',
    label: 'cdk deploy',
    points: [
      [570, 790],
      [625, 790],
      [625, 700],
      [1060, 700],
      [1060, 815],
      [1110, 815],
    ],
    labelAt: [840, 700],
  },
  {
    from: 'anomaly',
    to: 'email',
    type: 'cost',
    label: 'Budgets + Anomaly → อีเมล',
    points: [
      [840, 945],
      [840, 1020],
    ],
    labelAt: [840, 995],
  },
]

const canvas = document.getElementById('canvas')
const svg = document.getElementById('edges')
const NS = 'http://www.w3.org/2000/svg'

// ---------- markers ----------
const defs = document.getElementById('markers')
for (const [type, color] of Object.entries(COLORS)) {
  const m = document.createElementNS(NS, 'marker')
  m.setAttribute('id', `arrow-${type}`)
  m.setAttribute('viewBox', '0 0 10 10')
  m.setAttribute('refX', '9')
  m.setAttribute('refY', '5')
  m.setAttribute('markerWidth', '7')
  m.setAttribute('markerHeight', '7')
  m.setAttribute('orient', 'auto-start-reverse')
  const p = document.createElementNS(NS, 'path')
  p.setAttribute('d', 'M0,0 L10,5 L0,10 z')
  p.setAttribute('fill', color)
  m.appendChild(p)
  defs.appendChild(m)
}

// ---------- boxes ----------
const box = (cls, r) => {
  const el = document.createElement('div')
  el.className = cls
  Object.assign(el.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
  })
  canvas.appendChild(el)
  return el
}

box('cloud', CLOUD).innerHTML = `<span class="tag">${CLOUD.label}</span>`
for (const g of GROUPS) {
  box(`group${g.external ? ' external' : ''}`, g).innerHTML =
    `<span class="tag"><b>${g.name}</b>${g.note ? ` · ${g.note}` : ''}</span>`
}

const rules = box('rules', { x: 1080, y: 450, w: 310, h: 220 })
rules.classList.add('group')
rules.innerHTML = `<span class="tag"><b>CostGuardAspect</b> · ตรวจตอน synth</span>
        <ul>
          <li>ห้าม RDS, EC2, NAT, EIP, ELB, ElastiCache, OpenSearch, WAF, KMS Key, Secrets Manager</li>
          <li>Lambda: Node 22 · arm64 · 256 MB · ≤ 10s · ไม่มี VPC</li>
          <li>Log retention 7 วัน</li>
          <li>DynamoDB on-demand</li>
          <li>ทุก resource ติด tag <code>project=money-flow</code></li>
        </ul>`

const nodeEls = {}
for (const n of NODES) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'node'
  el.dataset.id = n.id
  Object.assign(el.style, {
    left: `${n.x}px`,
    top: `${n.y}px`,
    width: `${n.w}px`,
    height: `${n.h}px`,
  })
  el.innerHTML = `
          <div class="icon" style="background:${n.color}">${n.icon}</div>
          <div>
            <div class="title">${n.title}</div>
            <div class="sub">${n.sub}</div>
            ${n.chips ? `<div class="chips">${n.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
          </div>`
  el.addEventListener('click', () => select(n.id))
  canvas.appendChild(el)
  nodeEls[n.id] = el
}

// ---------- edges ----------
const edgeEls = EDGES.map((e) => {
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('class', `edge${e.dashed ? ' dashed' : ''}`)
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('d', roundedPath(e.points, 8))
  path.setAttribute('stroke', COLORS[e.type])
  path.setAttribute('marker-end', `url(#arrow-${e.type})`)
  g.appendChild(path)

  if (e.label) {
    const [lx, ly] = e.labelAt ?? midOfLongest(e.points)
    const text = document.createElementNS(NS, 'text')
    text.setAttribute('x', lx)
    text.setAttribute('y', ly + 4)
    text.setAttribute('text-anchor', 'middle')
    text.textContent = e.label
    const rect = document.createElementNS(NS, 'rect')
    g.appendChild(rect)
    g.appendChild(text)
    svg.appendChild(g)
    const b = text.getBBox()
    rect.setAttribute('x', b.x - 5)
    rect.setAttribute('y', b.y - 2)
    rect.setAttribute('width', b.width + 10)
    rect.setAttribute('height', b.height + 4)
    rect.setAttribute('rx', 4)
  } else {
    svg.appendChild(g)
  }
  return { ...e, el: g }
})

function midOfLongest(pts) {
  let best = 0
  let mid = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]
    const [x2, y2] = pts[i]
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len > best) {
      best = len
      mid = [(x1 + x2) / 2, (y1 + y2) / 2]
    }
  }
  return mid
}

// polyline มุมโค้ง
function roundedPath(pts, r) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const d1 = Math.hypot(cx - px, cy - py) || 1
    const d2 = Math.hypot(nx - cx, ny - cy) || 1
    const rr = Math.min(r, d1 / 2, d2 / 2)
    d += ` L${cx - ((cx - px) / d1) * rr},${cy - ((cy - py) / d1) * rr}`
    d += ` Q${cx},${cy} ${cx + ((nx - cx) / d2) * rr},${cy + ((ny - cy) / d2) * rr}`
  }
  const last = pts[pts.length - 1]
  return `${d} L${last[0]},${last[1]}`
}

// ---------- selection ----------
const detail = document.getElementById('detail')
let current = null

function select(id) {
  if (current === id) {
    current = null
    canvas.classList.remove('dim')
    document
      .querySelectorAll('.related, .active')
      .forEach((el) => el.classList.remove('related', 'active'))
    return
  }
  current = id
  const n = NODES.find((x) => x.id === id)
  document
    .querySelectorAll('.related, .active')
    .forEach((el) => el.classList.remove('related', 'active'))
  canvas.classList.add('dim')
  nodeEls[id].classList.add('active', 'related')

  const links = []
  for (const e of edgeEls) {
    if (e.from === id || e.to === id) {
      e.el.classList.add('related')
      nodeEls[e.from].classList.add('related')
      nodeEls[e.to].classList.add('related')
      const other = NODES.find((x) => x.id === (e.from === id ? e.to : e.from))
      links.push(
        `${e.from === id ? '→' : '←'} ${other.title}${e.label ? ` <span class="hint">(${e.label})</span>` : ''}`,
      )
    }
  }

  detail.innerHTML = `
          <div class="stack">${n.stack}</div>
          <h2>${n.title}</h2>
          <div class="hint">${n.sub}</div>
          <ul>${n.details.map((d) => `<li>${d}</li>`).join('')}</ul>
          ${links.length ? `<h3 style="font-size:14px;margin:14px 0 0">การเชื่อมต่อ</h3><ul>${links.map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}`
}

// ---------- scale to fit ----------
const wrap = document.getElementById('wrap')
function fit() {
  const s = Math.min(1, wrap.clientWidth / 1440)
  canvas.style.transform = `scale(${s})`
  wrap.style.height = `${1100 * s}px`
}
new ResizeObserver(fit).observe(wrap)
fit()
