import ApplicationsAdmin from '@/components/admin/ApplicationsAdmin';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminApplicationsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const jobId = one(searchParams.job_id);
  return <ApplicationsAdmin initialStatus={one(searchParams.status)} jobId={jobId && UUID.test(jobId) ? jobId : undefined} />;
}
