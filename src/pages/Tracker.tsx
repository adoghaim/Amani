import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Layout } from '../components/Layout';
import { Calendar } from '../components/Calendar';
import { LabsTimeline } from '../components/LabsTimeline';
import { Loading } from '../components/Loading';
import { LabReport, Biomarker, CycleEvent } from '../types';

export function Tracker() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<LabReport[]>([]);
  const [biomarkersByReport, setBiomarkersByReport] = useState<Record<string, Biomarker[]>>({});
  const [cycleEvents, setCycleEvents] = useState<CycleEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [reportsResult, eventsResult] = await Promise.all([
        supabase
          .from('lab_reports')
          .select('*')
          .eq('user_id', user.id)
          .order('report_date', { ascending: false }),
        supabase
          .from('cycle_events')
          .select('*')
          .eq('user_id', user.id)
          .order('event_date', { ascending: false }),
      ]);

      if (reportsResult.error) throw reportsResult.error;
      if (eventsResult.error) throw eventsResult.error;

      const fetchedReports = reportsResult.data as LabReport[];
      setReports(fetchedReports);
      setCycleEvents(eventsResult.data as CycleEvent[]);

      if (fetchedReports.length > 0) {
        const reportIds = fetchedReports.map((r) => r.id);
        const { data: biomarkersData, error: biomarkersError } = await supabase
          .from('biomarkers')
          .select('*')
          .in('lab_report_id', reportIds);

        if (biomarkersError) throw biomarkersError;

        const grouped = (biomarkersData as Biomarker[]).reduce((acc, biomarker) => {
          if (!acc[biomarker.lab_report_id]) {
            acc[biomarker.lab_report_id] = [];
          }
          acc[biomarker.lab_report_id].push(biomarker);
          return acc;
        }, {} as Record<string, Biomarker[]>);

        setBiomarkersByReport(grouped);
      }
    } catch (error) {
      console.error('Error fetching tracker data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = async (date: string) => {
    const existingEvent = cycleEvents.find(
      (e) => e.event_date === date && e.event_type === 'period_start'
    );

    if (existingEvent) {
      const confirmDelete = window.confirm('Remove period start marker from this date?');
      if (confirmDelete) {
        await deletePeriodEvent(existingEvent.id);
      }
    } else {
      const confirmAdd = window.confirm('Add period start marker to this date?');
      if (confirmAdd) {
        await addPeriodEvent(date);
      }
    }
  };

  const addPeriodEvent = async (date: string) => {
    if (!user) return;

    try {
      const { error } = await supabase.from('cycle_events').insert({
        user_id: user.id,
        event_date: date,
        event_type: 'period_start',
      });

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error adding period event:', error);
      alert('Failed to add period start marker. Please try again.');
    }
  };

  const deletePeriodEvent = async (eventId: string) => {
    try {
      const { error } = await supabase.from('cycle_events').delete().eq('id', eventId);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error deleting period event:', error);
      alert('Failed to remove period start marker. Please try again.');
    }
  };

  const calendarEvents = [
    ...reports.map((r) => ({
      date: r.report_date,
      type: 'lab' as const,
      label: r.lab_name || 'Lab report',
    })),
    ...cycleEvents
      .filter((e) => e.event_type === 'period_start')
      .map((e) => ({
        date: e.event_date,
        type: 'period' as const,
      })),
  ];

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Tracker</h1>
          <p className="mt-2 text-gray-600">
            Track your lab results over time and overlay your menstrual cycle
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Calendar</h2>
            <Calendar events={calendarEvents} onDateClick={handleDateClick} />
            <div className="mt-4 p-4 bg-teal-50 rounded-lg border border-teal-200">
              <p className="text-sm text-gray-700">
                Click any date to add or remove a period start marker. This helps you track your cycle
                alongside your lab results.
              </p>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Labs Timeline</h2>
            <div className="space-y-4 max-h-[800px] overflow-y-auto">
              <LabsTimeline reports={reports} biomarkersByReport={biomarkersByReport} />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
