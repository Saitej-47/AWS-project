export type Resource = {
  id: string;
  name: string;
  service: 'EC2' | 'RDS' | 'EBS' | 'Lambda';
  region: string;
  instanceType: string;
  cpu: number;
  memory: number;
  network: number;
  storage: number;
  monthlyCost: number;
  status: 'Over-provisioned' | 'Healthy' | 'Needs review' | 'Optimized';
  risk: 'Low' | 'Medium' | 'High';
  env: 'Production' | 'Staging' | 'Development';
  instanceId: string;
  recommendationId?: string;
  peakCpu: number;
  peakMemory: number;
};

export type Recommendation = {
  id: string;
  resourceId: string;
  resourceName: string;
  current: string;
  recommended: string;
  currentCost: number;
  optimizedCost: number;
  savings: number;
  risk: 'Low' | 'Medium' | 'High';
  confidence: number;
  status: 'Open' | 'Reviewed' | 'Approved' | 'Rejected';
  rationale: string;
};

export const resources: Resource[] = [
  { id: 'r-001', name: 'Production-Web-01', service: 'EC2', region: 'ap-south-1', instanceType: 'm5.2xlarge', cpu: 18, memory: 24, network: 12, storage: 42, monthlyCost: 18400, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f701', recommendationId: 'rec-001', peakCpu: 34, peakMemory: 41 },
  { id: 'r-002', name: 'Production-Web-02', service: 'EC2', region: 'ap-south-1', instanceType: 'm5.2xlarge', cpu: 22, memory: 29, network: 15, storage: 38, monthlyCost: 18400, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f702', recommendationId: 'rec-002', peakCpu: 39, peakMemory: 48 },
  { id: 'r-003', name: 'Analytics-Cluster-01', service: 'EC2', region: 'us-east-1', instanceType: 'm5.4xlarge', cpu: 44, memory: 52, network: 48, storage: 68, monthlyCost: 39200, status: 'Healthy', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f703', peakCpu: 78, peakMemory: 81 },
  { id: 'r-004', name: 'Analytics-Cluster-02', service: 'EC2', region: 'us-east-1', instanceType: 'm5.4xlarge', cpu: 39, memory: 47, network: 42, storage: 63, monthlyCost: 39200, status: 'Needs review', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f704', recommendationId: 'rec-003', peakCpu: 73, peakMemory: 79 },
  { id: 'r-005', name: 'Payment-Service-01', service: 'EC2', region: 'eu-west-1', instanceType: 'c5.2xlarge', cpu: 63, memory: 58, network: 74, storage: 51, monthlyCost: 22100, status: 'Healthy', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f705', peakCpu: 89, peakMemory: 83 },
  { id: 'r-006', name: 'Payment-Service-02', service: 'EC2', region: 'eu-west-1', instanceType: 'c5.2xlarge', cpu: 57, memory: 61, network: 68, storage: 48, monthlyCost: 22100, status: 'Healthy', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f706', peakCpu: 84, peakMemory: 88 },
  { id: 'r-007', name: 'Customer-API-01', service: 'EC2', region: 'ap-southeast-1', instanceType: 't3.xlarge', cpu: 27, memory: 31, network: 22, storage: 35, monthlyCost: 8900, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f707', recommendationId: 'rec-004', peakCpu: 45, peakMemory: 54 },
  { id: 'r-008', name: 'Customer-API-02', service: 'EC2', region: 'ap-southeast-1', instanceType: 't3.xlarge', cpu: 31, memory: 36, network: 26, storage: 37, monthlyCost: 8900, status: 'Needs review', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f708', peakCpu: 52, peakMemory: 58 },
  { id: 'r-009', name: 'Data-Processing-01', service: 'EC2', region: 'us-west-2', instanceType: 'r5.2xlarge', cpu: 24, memory: 19, network: 31, storage: 71, monthlyCost: 26400, status: 'Over-provisioned', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f709', recommendationId: 'rec-005', peakCpu: 42, peakMemory: 38 },
  { id: 'r-010', name: 'Data-Processing-02', service: 'EC2', region: 'us-west-2', instanceType: 'r5.2xlarge', cpu: 33, memory: 28, network: 34, storage: 74, monthlyCost: 26400, status: 'Needs review', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f710', peakCpu: 57, peakMemory: 49 },
  { id: 'r-011', name: 'Production-Database-01', service: 'RDS', region: 'ap-south-1', instanceType: 'db.r6g.2xlarge', cpu: 36, memory: 41, network: 45, storage: 62, monthlyCost: 34800, status: 'Needs review', risk: 'High', env: 'Production', instanceId: 'db-prod-01', recommendationId: 'rec-006', peakCpu: 68, peakMemory: 72 },
  { id: 'r-012', name: 'Production-Database-Replica', service: 'RDS', region: 'ap-south-1', instanceType: 'db.r6g.xlarge', cpu: 21, memory: 27, network: 28, storage: 57, monthlyCost: 17400, status: 'Over-provisioned', risk: 'Medium', env: 'Production', instanceId: 'db-prod-replica-01', recommendationId: 'rec-007', peakCpu: 39, peakMemory: 45 },
  { id: 'r-013', name: 'Orders-Data-Volume', service: 'EBS', region: 'ap-south-1', instanceType: 'gp3 · 1 TB', cpu: 12, memory: 18, network: 9, storage: 29, monthlyCost: 6200, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'vol-0a91orders', recommendationId: 'rec-008', peakCpu: 19, peakMemory: 25 },
  { id: 'r-014', name: 'Customer-Archive-Volume', service: 'EBS', region: 'eu-west-1', instanceType: 'gp3 · 2 TB', cpu: 8, memory: 14, network: 6, storage: 17, monthlyCost: 8100, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'vol-0b81archive', peakCpu: 15, peakMemory: 19 },
  { id: 'r-015', name: 'Checkout-Authorizer', service: 'Lambda', region: 'us-east-1', instanceType: '1024 MB', cpu: 54, memory: 47, network: 36, storage: 22, monthlyCost: 3200, status: 'Healthy', risk: 'Low', env: 'Production', instanceId: 'fn-checkout-auth', peakCpu: 83, peakMemory: 68 },
  { id: 'r-016', name: 'Image-Resize-Worker', service: 'Lambda', region: 'us-east-1', instanceType: '2048 MB', cpu: 17, memory: 23, network: 19, storage: 31, monthlyCost: 2700, status: 'Over-provisioned', risk: 'Low', env: 'Production', instanceId: 'fn-image-resize', peakCpu: 32, peakMemory: 39, recommendationId: 'rec-009' , },
  { id: 'r-017', name: 'Staging-Web-01', service: 'EC2', region: 'ap-south-1', instanceType: 't3.large', cpu: 14, memory: 21, network: 9, storage: 27, monthlyCost: 4600, status: 'Over-provisioned', risk: 'Low', env: 'Staging', instanceId: 'i-0f1a2b3c4d5e6f717', peakCpu: 28, peakMemory: 35 },
  { id: 'r-018', name: 'Staging-Database-01', service: 'RDS', region: 'ap-south-1', instanceType: 'db.t3.large', cpu: 19, memory: 26, network: 12, storage: 38, monthlyCost: 7100, status: 'Healthy', risk: 'Low', env: 'Staging', instanceId: 'db-staging-01', peakCpu: 34, peakMemory: 43 },
  { id: 'r-019', name: 'Dev-Feature-Branch-01', service: 'EC2', region: 'us-east-1', instanceType: 't3.medium', cpu: 9, memory: 16, network: 7, storage: 21, monthlyCost: 2100, status: 'Needs review', risk: 'Medium', env: 'Development', instanceId: 'i-0f1a2b3c4d5e6f719', peakCpu: 21, peakMemory: 32 },
  { id: 'r-020', name: 'Dev-Feature-Branch-02', service: 'EC2', region: 'us-east-1', instanceType: 't3.medium', cpu: 12, memory: 18, network: 8, storage: 22, monthlyCost: 2100, status: 'Optimized', risk: 'Low', env: 'Development', instanceId: 'i-0f1a2b3c4d5e6f720', peakCpu: 23, peakMemory: 34 },
  { id: 'r-021', name: 'Observability-Collector', service: 'EC2', region: 'eu-west-1', instanceType: 'm5.xlarge', cpu: 48, memory: 44, network: 59, storage: 46, monthlyCost: 12200, status: 'Healthy', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f721', peakCpu: 71, peakMemory: 69 },
  { id: 'r-022', name: 'Fraud-Scoring-Worker', service: 'EC2', region: 'us-east-1', instanceType: 'c5.xlarge', cpu: 71, memory: 65, network: 62, storage: 44, monthlyCost: 11400, status: 'Healthy', risk: 'Low', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f722', peakCpu: 93, peakMemory: 88 },
  { id: 'r-023', name: 'Marketing-Assets-Volume', service: 'EBS', region: 'us-west-2', instanceType: 'gp3 · 500 GB', cpu: 11, memory: 15, network: 4, storage: 24, monthlyCost: 3300, status: 'Optimized', risk: 'Low', env: 'Production', instanceId: 'vol-0c72marketing', peakCpu: 18, peakMemory: 21 },
  { id: 'r-024', name: 'Batch-Export-Runner', service: 'EC2', region: 'us-west-2', instanceType: 'm5.2xlarge', cpu: 29, memory: 34, network: 41, storage: 59, monthlyCost: 18400, status: 'Needs review', risk: 'Medium', env: 'Production', instanceId: 'i-0f1a2b3c4d5e6f724', recommendationId: 'rec-010', peakCpu: 64, peakMemory: 61 },
];

export const recommendations: Recommendation[] = [
  { id: 'rec-001', resourceId: 'r-001', resourceName: 'Production-Web-01', current: 'm5.2xlarge', recommended: 'm5.large', currentCost: 18400, optimizedCost: 9980, savings: 8420, risk: 'Low', confidence: 94, status: 'Open', rationale: 'The resource has maintained low CPU and memory utilization during the observed period. The current instance provides significantly more capacity than the workload typically requires.' },
  { id: 'rec-002', resourceId: 'r-002', resourceName: 'Production-Web-02', current: 'm5.2xlarge', recommended: 'm5.large', currentCost: 18400, optimizedCost: 9980, savings: 8420, risk: 'Low', confidence: 91, status: 'Reviewed', rationale: 'Observed utilization remains below the recommended operating envelope across the last 30 days.' },
  { id: 'rec-003', resourceId: 'r-004', resourceName: 'Analytics-Cluster-02', current: 'm5.4xlarge', recommended: 'm5.2xlarge', currentCost: 39200, optimizedCost: 26400, savings: 12800, risk: 'Medium', confidence: 78, status: 'Open', rationale: 'The analytics worker has meaningful headroom, but peak processing windows warrant a controlled validation before change.' },
  { id: 'rec-004', resourceId: 'r-007', resourceName: 'Customer-API-01', current: 't3.xlarge', recommended: 't3.large', currentCost: 8900, optimizedCost: 5120, savings: 3780, risk: 'Low', confidence: 89, status: 'Open', rationale: 'CPU and memory demand are consistently low with modest network throughput.' },
  { id: 'rec-005', resourceId: 'r-009', resourceName: 'Data-Processing-01', current: 'r5.2xlarge', recommended: 'r5.xlarge', currentCost: 26400, optimizedCost: 18620, savings: 7780, risk: 'Medium', confidence: 82, status: 'Reviewed', rationale: 'Memory headroom is larger than needed in the observed period; keep batch completion time under review.' },
  { id: 'rec-006', resourceId: 'r-011', resourceName: 'Production-Database-01', current: 'db.r6g.2xlarge', recommended: 'db.r6g.xlarge', currentCost: 34800, optimizedCost: 23200, savings: 11600, risk: 'High', confidence: 69, status: 'Open', rationale: 'Database utilization suggests a smaller class may be viable, but production query latency should be validated with a staged test.' },
  { id: 'rec-007', resourceId: 'r-012', resourceName: 'Production-Database-Replica', current: 'db.r6g.xlarge', recommended: 'db.r6g.large', currentCost: 17400, optimizedCost: 11280, savings: 6120, risk: 'Medium', confidence: 76, status: 'Open', rationale: 'Replica load is consistently low outside the morning reporting window.' },
  { id: 'rec-008', resourceId: 'r-013', resourceName: 'Orders-Data-Volume', current: 'gp3 · 1 TB', recommended: 'gp3 · 500 GB', currentCost: 6200, optimizedCost: 3100, savings: 3100, risk: 'Low', confidence: 97, status: 'Approved', rationale: 'Storage consumption has remained below half of allocated capacity for 90 days.' },
  { id: 'rec-009', resourceId: 'r-016', resourceName: 'Image-Resize-Worker', current: '2048 MB', recommended: '1024 MB', currentCost: 2700, optimizedCost: 1390, savings: 1310, risk: 'Low', confidence: 93, status: 'Open', rationale: 'The function has ample memory headroom and no elevated duration trend.' },
  { id: 'rec-010', resourceId: 'r-024', resourceName: 'Batch-Export-Runner', current: 'm5.2xlarge', recommended: 'm5.xlarge', currentCost: 18400, optimizedCost: 12160, savings: 6240, risk: 'Medium', confidence: 81, status: 'Open', rationale: 'The runner is underutilized between scheduled exports; validate the peak batch window before approval.' },
];

export const costTrend = [
  { day: '01 Aug', current: 348000, optimized: 278430 }, { day: '04 Aug', current: 352800, optimized: 283230 }, { day: '07 Aug', current: 356600, optimized: 287030 }, { day: '10 Aug', current: 354400, optimized: 284830 }, { day: '13 Aug', current: 358200, optimized: 288630 }, { day: '16 Aug', current: 360900, optimized: 291330 }, { day: '19 Aug', current: 363100, optimized: 293530 }, { day: '22 Aug', current: 361400, optimized: 291830 }, { day: '25 Aug', current: 358700, optimized: 289130 }, { day: '28 Aug', current: 363600, optimized: 294030 },
];

export const serviceSavings = [
  { name: 'EC2', value: 47440, color: '#ff9900' }, { name: 'EBS', value: 3100, color: '#5b7cfa' }, { name: 'RDS', value: 17720, color: '#35a785' }, { name: 'Lambda', value: 1310, color: '#9b7cf4' },
];

export const costByService = [
  { name: 'EC2', current: 280800, optimized: 233360 }, { name: 'RDS', current: 59300, optimized: 41580 }, { name: 'EBS', current: 17600, optimized: 14500 }, { name: 'Lambda', current: 5900, optimized: 4590 },
];

export const utilizationBuckets = [
  { label: '0–20%', count: 9, color: '#ffead2' }, { label: '20–40%', count: 9, color: '#ffd39b' }, { label: '40–60%', count: 4, color: '#ffb45b' }, { label: '60–80%', count: 2, color: '#ff9900' }, { label: '80%+', count: 0, color: '#df6a32' },
];

export const activityLogs = [
  { time: '2:41 PM', group: 'Today', action: 'Reviewed resource', resource: 'Production-Web-01', user: 'Admin', status: 'Completed' },
  { time: '1:28 PM', group: 'Today', action: 'Approved recommendation', resource: 'Orders-Data-Volume', user: 'Admin', status: 'Approved' },
  { time: '11:42 AM', group: 'Today', action: 'Recommendation generated', resource: 'Batch-Export-Runner', user: 'System', status: 'Generated' },
  { time: '4:15 PM', group: 'Yesterday', action: 'Optimization report generated', resource: 'Monthly Optimization Report', user: 'Admin', status: 'Ready' },
  { time: '10:06 AM', group: 'Yesterday', action: 'Viewed recommendation', resource: 'Production-Database-01', user: 'Priya N.', status: 'Reviewed' },
  { time: '09:44 AM', group: 'Yesterday', action: 'Environment switched', resource: 'Demo Environment', user: 'Admin', status: 'Completed' },
  { time: '5:12 PM', group: '18 Sep', action: 'Resource inventory refreshed', resource: '127 resources', user: 'System', status: 'Completed' },
];

export const fmt = (value: number) => `₹${value.toLocaleString('en-IN')}`;
export const monthlySpend = 363600;
export const totalSavings = 69570;
export const annualSavings = 834840;
export const navItems = [
  { label: 'Overview', path: '/overview', icon: 'LayoutDashboard' },
  { label: 'Resources', path: '/resources', icon: 'Server' },
  { label: 'Recommendations', path: '/recommendations', icon: 'Sparkles', count: recommendations.length },
  { label: 'Cost Analysis', path: '/cost-analysis', icon: 'BarChart3' },
  { label: 'Utilization', path: '/utilization', icon: 'Activity' },
  { label: 'What-If Simulator', path: '/simulator', icon: 'FlaskConical' },
  { label: 'Action Center', path: '/actions', icon: 'ListChecks' },
  { label: 'Savings', path: '/savings', icon: 'TrendingUp' },
  { label: 'Policies', path: '/policies', icon: 'ShieldCheck' },
  { label: 'Reports', path: '/reports', icon: 'FileText' },
  { label: 'Activity / Audit Log', path: '/activity', icon: 'ListChecks' },
  { label: 'AWS Connection', path: '/aws', icon: 'Cloud' },
  { label: 'Settings', path: '/settings', icon: 'Settings' },
] as const;

export const getResource = (id: string) => resources.find((resource) => resource.id === id) || resources[0];
export const getRecommendation = (id: string) => recommendations.find((recommendation) => recommendation.id === id) || recommendations[0];

export const reportArtifacts = [
  { title: 'Monthly Optimization Report', date: 'August 2026', status: 'Ready' as const },
  { title: 'Executive Cost Brief', date: 'July 2026', status: 'Ready' as const },
  { title: 'Rightsizing Evidence Pack', date: 'July 2026', status: 'Archived' as const },
];
