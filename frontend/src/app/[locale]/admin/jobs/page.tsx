import JobsList from '@/components/admin/JobsList';

export const dynamic = 'force-dynamic';

export default function AdminJobsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const status = typeof searchParams.status === 'string' ? searchParams.status : undefined;
  return <JobsList key={status ?? ''} initialStatus={status} />;
}
