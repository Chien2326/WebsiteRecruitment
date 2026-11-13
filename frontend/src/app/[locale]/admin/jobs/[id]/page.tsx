import JobEditor from '@/components/admin/JobEditor';

export default function EditJobPage({ params: { id } }: { params: { id: string } }) {
  return <JobEditor key={id} jobId={id} />;
}
