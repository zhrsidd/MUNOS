export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      archive_jobs: {
        Row: {
          archive_id: string | null
          attempts: number
          committee_id: string
          conference_id: string
          created_at: string
          id: string
          last_error: string | null
          state: string
          updated_at: string
          version_id: string
        }
        Insert: {
          archive_id?: string | null
          attempts?: number
          committee_id: string
          conference_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          state?: string
          updated_at?: string
          version_id: string
        }
        Update: {
          archive_id?: string | null
          attempts?: number
          committee_id?: string
          conference_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          state?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archive_jobs_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "archive_jobs_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archive_jobs_version_id_conference_id_committee_id_fkey"
            columns: ["version_id", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      attendance: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          delegateId: string
          id: string
          revision: number
          sessionId: string
          status: Database["public"]["Enums"]["attendance_state"]
          updated_at: string
          updatedAt: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          delegateId: string
          id?: string
          revision?: number
          sessionId: string
          status: Database["public"]["Enums"]["attendance_state"]
          updated_at?: string
          updatedAt?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          delegateId?: string
          id?: string
          revision?: number
          sessionId?: string
          status?: Database["public"]["Enums"]["attendance_state"]
          updated_at?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "attendance_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "attendance_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actorId: string
          committee_id: string | null
          conference_id: string
          created_at: string
          createdAt: string
          details: Json
          entityId: string | null
          id: string
          mutation_id: string
          updated_at: string
        }
        Insert: {
          action: string
          actorId: string
          committee_id?: string | null
          conference_id: string
          created_at?: string
          createdAt?: string
          details: Json
          entityId?: string | null
          id?: string
          mutation_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          actorId?: string
          committee_id?: string | null
          conference_id?: string
          created_at?: string
          createdAt?: string
          details?: Json
          entityId?: string | null
          id?: string
          mutation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "audit_log_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      award_criteria: {
        Row: {
          committee_id: string | null
          conference_id: string
          created_at: string
          description: string
          id: string
          max: number
          name: string
          updated_at: string
        }
        Insert: {
          committee_id?: string | null
          conference_id: string
          created_at?: string
          description: string
          id?: string
          max: number
          name: string
          updated_at?: string
        }
        Update: {
          committee_id?: string | null
          conference_id?: string
          created_at?: string
          description?: string
          id?: string
          max?: number
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "award_criteria_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "award_criteria_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      award_scores: {
        Row: {
          chairId: string
          committee_id: string
          conference_id: string
          created_at: string
          criterionId: string
          delegateId: string
          id: string
          notes: string
          score: number
          updated_at: string
        }
        Insert: {
          chairId: string
          committee_id: string
          conference_id: string
          created_at?: string
          criterionId: string
          delegateId: string
          id?: string
          notes?: string
          score: number
          updated_at?: string
        }
        Update: {
          chairId?: string
          committee_id?: string
          conference_id?: string
          created_at?: string
          criterionId?: string
          delegateId?: string
          id?: string
          notes?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "award_scores_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "award_scores_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "award_scores_criterionId_conference_id_fkey"
            columns: ["criterionId", "conference_id"]
            isOneToOne: false
            referencedRelation: "award_criteria"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "award_scores_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      committee_staff: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          id: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          id?: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          id?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "committee_staff_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "committee_staff_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_staff_staff_id_conference_id_fkey"
            columns: ["staff_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      committees: {
        Row: {
          code: string
          conference_id: string
          created_at: string
          currentSessionId: string | null
          id: string
          name: string
          room: string
          sessionRevision: number
          updated_at: string
          vetoDelegateIds: string[]
          vetoEnabled: boolean
          voting_rule: string | null
        }
        Insert: {
          code: string
          conference_id: string
          created_at?: string
          currentSessionId?: string | null
          id?: string
          name: string
          room: string
          sessionRevision?: number
          updated_at?: string
          vetoDelegateIds?: string[]
          vetoEnabled?: boolean
          voting_rule?: string | null
        }
        Update: {
          code?: string
          conference_id?: string
          created_at?: string
          currentSessionId?: string | null
          id?: string
          name?: string
          room?: string
          sessionRevision?: number
          updated_at?: string
          vetoDelegateIds?: string[]
          vetoEnabled?: boolean
          voting_rule?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "committees_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committees_currentSessionId_conference_id_id_fkey"
            columns: ["currentSessionId", "conference_id", "id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      conference_staff: {
        Row: {
          conference_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["conference_role"]
          staff_id: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["conference_role"]
          staff_id: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["conference_role"]
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_staff_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_staff_staff_id_conference_id_fkey"
            columns: ["staff_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      conferences: {
        Row: {
          created_at: string
          date: string
          features: Json
          id: string
          name: string
          updated_at: string
          venue: string
          voting_rule: string
        }
        Insert: {
          created_at?: string
          date: string
          features?: Json
          id?: string
          name: string
          updated_at?: string
          venue: string
          voting_rule?: string
        }
        Update: {
          created_at?: string
          date?: string
          features?: Json
          id?: string
          name?: string
          updated_at?: string
          venue?: string
          voting_rule?: string
        }
        Relationships: []
      }
      debate_states: {
        Row: {
          committee_id: string
          conference_id: string
          mode: string
          phase: string
          revision: number
          sessionId: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          mode?: string
          phase?: string
          revision?: number
          sessionId: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          mode?: string
          phase?: string
          revision?: number
          sessionId?: string
        }
        Relationships: [
          {
            foreignKeyName: "debate_states_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      delegates: {
        Row: {
          committee_id: string
          conference_id: string
          country: string
          created_at: string
          email: string
          flag: string
          id: string
          name: string
          schoolId: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          country: string
          created_at?: string
          email: string
          flag?: string
          id?: string
          name: string
          schoolId: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          country?: string
          created_at?: string
          email?: string
          flag?: string
          id?: string
          name?: string
          schoolId?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegates_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "delegates_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegates_schoolId_conference_id_fkey"
            columns: ["schoolId", "conference_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      document_comments: {
        Row: {
          authorId: string | null
          committee_id: string
          conference_id: string
          created_at: string
          createdAt: string
          documentId: string
          id: string
          text: string
          updated_at: string
        }
        Insert: {
          authorId?: string | null
          committee_id: string
          conference_id: string
          created_at?: string
          createdAt?: string
          documentId: string
          id?: string
          text: string
          updated_at?: string
        }
        Update: {
          authorId?: string | null
          committee_id?: string
          conference_id?: string
          created_at?: string
          createdAt?: string
          documentId?: string
          id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_comments_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "document_comments_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_comments_documentId_conference_id_committee_id_fkey"
            columns: ["documentId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      document_versions: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          createdAt: string
          createdBy: string | null
          documentId: string
          fileName: string
          id: string
          number: number
          storageKey: string | null
          text: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          createdAt?: string
          createdBy?: string | null
          documentId: string
          fileName: string
          id?: string
          number: number
          storageKey?: string | null
          text: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          createdAt?: string
          createdBy?: string | null
          documentId?: string
          fileName?: string
          id?: string
          number?: number
          storageKey?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "document_versions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_documentId_conference_id_committee_id_fkey"
            columns: ["documentId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      documents: {
        Row: {
          code: string
          committee_id: string
          conference_id: string
          copies: number
          created_at: string
          id: string
          outcome: Database["public"]["Enums"]["document_outcome"] | null
          revision: number
          sessionId: string | null
          status: Database["public"]["Enums"]["document_state"]
          submitterId: string
          title: string
          updated_at: string
          vetoedBy: string[]
          voteMode: string
          voteType: string
        }
        Insert: {
          code: string
          committee_id: string
          conference_id: string
          copies?: number
          created_at?: string
          id?: string
          outcome?: Database["public"]["Enums"]["document_outcome"] | null
          revision?: number
          sessionId?: string | null
          status?: Database["public"]["Enums"]["document_state"]
          submitterId: string
          title: string
          updated_at?: string
          vetoedBy?: string[]
          voteMode?: string
          voteType?: string
        }
        Update: {
          code?: string
          committee_id?: string
          conference_id?: string
          copies?: number
          created_at?: string
          id?: string
          outcome?: Database["public"]["Enums"]["document_outcome"] | null
          revision?: number
          sessionId?: string | null
          status?: Database["public"]["Enums"]["document_state"]
          submitterId?: string
          title?: string
          updated_at?: string
          vetoedBy?: string[]
          voteMode?: string
          voteType?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "documents_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "documents_submitterId_conference_id_committee_id_fkey"
            columns: ["submitterId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      operational_changes: {
        Row: {
          committee_id: string | null
          conference_id: string
          created_at: string
          id: string
          mutation_id: string
          topic: string
          updated_at: string
        }
        Insert: {
          committee_id?: string | null
          conference_id: string
          created_at?: string
          id?: string
          mutation_id: string
          topic: string
          updated_at?: string
        }
        Update: {
          committee_id?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          mutation_id?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_changes_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "operational_changes_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      participation_corrections: {
        Row: {
          actor_id: string
          committee_id: string
          conference_id: string
          created_at: string
          event_id: string
          id: string
          points: number | null
          sequence: number
          updated_at: string
          voided: boolean
        }
        Insert: {
          actor_id: string
          committee_id: string
          conference_id: string
          created_at?: string
          event_id: string
          id?: string
          points?: number | null
          sequence?: never
          updated_at?: string
          voided?: boolean
        }
        Update: {
          actor_id?: string
          committee_id?: string
          conference_id?: string
          created_at?: string
          event_id?: string
          id?: string
          points?: number | null
          sequence?: never
          updated_at?: string
          voided?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "participation_corrections_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "participation_corrections_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participation_corrections_event_id_conference_id_committee_fkey"
            columns: ["event_id", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "participation_events"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_corrections_event_id_conference_id_committee_fkey"
            columns: ["event_id", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "participation_history"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      participation_events: {
        Row: {
          categoryId: string
          chairId: string | null
          classification: string | null
          committee_id: string
          conference_id: string
          created_at: string
          createdAt: string
          delegateId: string
          id: string
          note: string | null
          points: number
          resolutionId: string | null
          sessionId: string
          speechId: string | null
          updated_at: string
          yieldedFrom: string | null
        }
        Insert: {
          categoryId: string
          chairId?: string | null
          classification?: string | null
          committee_id: string
          conference_id: string
          created_at?: string
          createdAt?: string
          delegateId: string
          id?: string
          note?: string | null
          points: number
          resolutionId?: string | null
          sessionId: string
          speechId?: string | null
          updated_at?: string
          yieldedFrom?: string | null
        }
        Update: {
          categoryId?: string
          chairId?: string | null
          classification?: string | null
          committee_id?: string
          conference_id?: string
          created_at?: string
          createdAt?: string
          delegateId?: string
          id?: string
          note?: string | null
          points?: number
          resolutionId?: string | null
          sessionId?: string
          speechId?: string | null
          updated_at?: string
          yieldedFrom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participation_events_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "participation_events_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participation_events_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_resolutionId_conference_id_committee__fkey"
            columns: ["resolutionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_speechId_conference_id_committee_id_fkey"
            columns: ["speechId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_yieldedFrom_conference_id_committee_i_fkey"
            columns: ["yieldedFrom", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      photo_acknowledgements: {
        Row: {
          actor_id: string
          committee_id: string
          conference_id: string
          created_at: string
          id: string
          slot_id: string
          slot_revision: number
          stage: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          committee_id: string
          conference_id: string
          created_at?: string
          id?: string
          slot_id: string
          slot_revision: number
          stage: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          committee_id?: string
          conference_id?: string
          created_at?: string
          id?: string
          slot_id?: string
          slot_revision?: number
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_acknowledgements_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "photo_acknowledgements_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_acknowledgements_slot_id_conference_id_fkey"
            columns: ["slot_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "photo_slots"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      photo_slots: {
        Row: {
          conference_id: string
          created_at: string
          enabled: boolean
          ends_at: string | null
          id: string
          location: string
          note: string
          revision: number
          school_id: string
          starts_at: string
          updated_at: string
          warn_minutes: number
        }
        Insert: {
          conference_id: string
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          location: string
          note?: string
          revision?: number
          school_id: string
          starts_at: string
          updated_at?: string
          warn_minutes?: number
        }
        Update: {
          conference_id?: string
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          location?: string
          note?: string
          revision?: number
          school_id?: string
          starts_at?: string
          updated_at?: string
          warn_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "photo_slots_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_slots_school_id_conference_id_fkey"
            columns: ["school_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id", "conference_id"]
          },
        ]
      }
      poi_queue: {
        Row: {
          committee_id: string
          conference_id: string
          delegateId: string
          id: string
          position: number
          recognizedAt: string | null
          speechId: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          delegateId: string
          id: string
          position: number
          recognizedAt?: string | null
          speechId: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          delegateId?: string
          id?: string
          position?: number
          recognizedAt?: string | null
          speechId?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_queue_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "poi_queue_speechId_conference_id_committee_id_fkey"
            columns: ["speechId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      resolution_links: {
        Row: {
          access: string
          approval_copy_doc_id: string | null
          committee_id: string
          conference_id: string
          created_at: string
          document_id: string
          revision: number
          submitted_at: string | null
          updated_at: string
          working_doc_id: string | null
        }
        Insert: {
          access?: string
          approval_copy_doc_id?: string | null
          committee_id: string
          conference_id: string
          created_at?: string
          document_id: string
          revision?: number
          submitted_at?: string | null
          updated_at?: string
          working_doc_id?: string | null
        }
        Update: {
          access?: string
          approval_copy_doc_id?: string | null
          committee_id?: string
          conference_id?: string
          created_at?: string
          document_id?: string
          revision?: number
          submitted_at?: string | null
          updated_at?: string
          working_doc_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resolution_links_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "resolution_links_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resolution_links_document_id_conference_id_committee_id_fkey"
            columns: ["document_id", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      schools: {
        Row: {
          conference_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          conference_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          conference_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schools_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_definitions: {
        Row: {
          code: string
          committee_id: string | null
          conference_id: string
          created_at: string
          id: string
          label: string
          updated_at: string
          values: number[]
        }
        Insert: {
          code: string
          committee_id?: string | null
          conference_id: string
          created_at?: string
          id?: string
          label: string
          updated_at?: string
          values: number[]
        }
        Update: {
          code?: string
          committee_id?: string | null
          conference_id?: string
          created_at?: string
          id?: string
          label?: string
          updated_at?: string
          values?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "scoring_definitions_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "scoring_definitions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          endsAt: string | null
          id: string
          name: string
          startsAt: string
          state: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          endsAt?: string | null
          id?: string
          name: string
          startsAt: string
          state: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          endsAt?: string | null
          id?: string
          name?: string
          startsAt?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "sessions_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      speaker_queue: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          delegateId: string
          id: string
          lane: string
          position: number
          sessionId: string
          state: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          delegateId: string
          id?: string
          lane?: string
          position?: number
          sessionId: string
          state?: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          delegateId?: string
          id?: string
          lane?: string
          position?: number
          sessionId?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaker_queue_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "speaker_queue_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speaker_queue_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "speaker_queue_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      speeches: {
        Row: {
          amendmentId: string | null
          classification: string
          committee_id: string
          conference_id: string
          createdAt: string
          delegateId: string
          id: string
          poiCount: number
          poiLimit: number | null
          resolutionId: string | null
          revision: number
          sessionId: string
          state: string
          yieldedFrom: string | null
        }
        Insert: {
          amendmentId?: string | null
          classification: string
          committee_id: string
          conference_id: string
          createdAt?: string
          delegateId: string
          id: string
          poiCount?: number
          poiLimit?: number | null
          resolutionId?: string | null
          revision?: number
          sessionId: string
          state?: string
          yieldedFrom?: string | null
        }
        Update: {
          amendmentId?: string | null
          classification?: string
          committee_id?: string
          conference_id?: string
          createdAt?: string
          delegateId?: string
          id?: string
          poiCount?: number
          poiLimit?: number | null
          resolutionId?: string | null
          revision?: number
          sessionId?: string
          state?: string
          yieldedFrom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speeches_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "speeches_resolutionId_conference_id_committee_id_fkey"
            columns: ["resolutionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "speeches_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "speeches_yieldedFrom_conference_id_committee_id_fkey"
            columns: ["yieldedFrom", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      staff: {
        Row: {
          auth_user_id: string | null
          conference_id: string
          contactRevision: number
          created_at: string
          email: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          conference_id: string
          contactRevision?: number
          created_at?: string
          email?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          conference_id?: string
          contactRevision?: number
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_links: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          created_by: string | null
          id: string
          revoked_at: string | null
          share_with: string
          token: string
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          revoked_at?: string | null
          share_with?: string
          token: string
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          revoked_at?: string | null
          share_with?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_links_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "submission_links_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      timers: {
        Row: {
          committee_id: string
          conference_id: string
          created_at: string
          duration: number
          id: string
          remaining: number
          revision: number
          sessionId: string
          startedAt: number | null
          updated_at: string
        }
        Insert: {
          committee_id: string
          conference_id: string
          created_at?: string
          duration: number
          id?: string
          remaining: number
          revision?: number
          sessionId: string
          startedAt?: number | null
          updated_at?: string
        }
        Update: {
          committee_id?: string
          conference_id?: string
          created_at?: string
          duration?: number
          id?: string
          remaining?: number
          revision?: number
          sessionId?: string
          startedAt?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timers_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "timers_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timers_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
      user_access: {
        Row: {
          committee_id: string | null
          conference_id: string
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["conference_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          committee_id?: string | null
          conference_id: string
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["conference_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          committee_id?: string | null
          conference_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["conference_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_access_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "user_access_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          choice: string
          committee_id: string
          conference_id: string
          created_at: string
          createdAt: string
          delegateId: string
          id: string
          resolutionId: string
          revision: number
          sessionId: string
          updated_at: string
        }
        Insert: {
          choice: string
          committee_id: string
          conference_id: string
          created_at?: string
          createdAt?: string
          delegateId: string
          id?: string
          resolutionId: string
          revision?: number
          sessionId: string
          updated_at?: string
        }
        Update: {
          choice?: string
          committee_id?: string
          conference_id?: string
          created_at?: string
          createdAt?: string
          delegateId?: string
          id?: string
          resolutionId?: string
          revision?: number
          sessionId?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "votes_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "votes_resolutionId_conference_id_committee_id_fkey"
            columns: ["resolutionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "votes_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
    }
    Views: {
      participation_history: {
        Row: {
          categoryId: string | null
          chairId: string | null
          committee_id: string | null
          conference_id: string | null
          corrected_at: string | null
          created_at: string | null
          createdAt: string | null
          delegateId: string | null
          effective_points: number | null
          id: string | null
          note: string | null
          points: number | null
          resolutionId: string | null
          sessionId: string | null
          updated_at: string | null
          voided_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participation_events_committee_id_conference_id_fkey"
            columns: ["committee_id", "conference_id"]
            isOneToOne: false
            referencedRelation: "committees"
            referencedColumns: ["id", "conference_id"]
          },
          {
            foreignKeyName: "participation_events_conference_id_fkey"
            columns: ["conference_id"]
            isOneToOne: false
            referencedRelation: "conferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participation_events_delegateId_conference_id_committee_id_fkey"
            columns: ["delegateId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "delegates"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_resolutionId_conference_id_committee__fkey"
            columns: ["resolutionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
          {
            foreignKeyName: "participation_events_sessionId_conference_id_committee_id_fkey"
            columns: ["sessionId", "conference_id", "committee_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "conference_id", "committee_id"]
          },
        ]
      }
    }
    Functions: {
      apply_conference_mutation: {
        Args: {
          client_time: string
          command: Json
          conf: string
          expected: string
          mutation: string
          requested_role: Database["public"]["Enums"]["conference_role"]
        }
        Returns: undefined
      }
      apply_operations_mutation: {
        Args: {
          client_time: string
          command: Json
          conf: string
          expected: string
          mutation: string
          requested_role: Database["public"]["Enums"]["conference_role"]
        }
        Returns: undefined
      }
      conference_snapshot: { Args: { conf: string }; Returns: Json }
      operations_snapshot: { Args: { conf: string }; Returns: Json }
      conference_state_snapshot: { Args: { conf: string }; Returns: Json }
      executive_state_snapshot: { Args: { conf: string }; Returns: Json }
      submission_link_info: { Args: { link_token: string }; Returns: Json }
      submit_resolution: {
        Args: {
          file_name: string
          file_sha256: string
          file_size: number
          google_doc_id: string
          link_token: string
          storage_key: string
          submission: string
          submitter: string
          title: string
        }
        Returns: Json
      }
    }
    Enums: {
      attendance_state: "Present" | "Present & Voting" | "Absent"
      conference_role: "chair" | "approval" | "logistics" | "admin" | "observer"
      document_outcome: "Passed" | "Failed" | "Withdrawn"
      document_state:
        | "Draft"
        | "Submitted"
        | "Review"
        | "Approved"
        | "Printed"
        | "In Debate"
        | "Closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_state: ["Present", "Present & Voting", "Absent"],
      conference_role: ["chair", "approval", "logistics", "admin", "observer"],
      document_outcome: ["Passed", "Failed", "Withdrawn"],
      document_state: [
        "Draft",
        "Submitted",
        "Review",
        "Approved",
        "Printed",
        "In Debate",
        "Closed",
      ],
    },
  },
} as const
