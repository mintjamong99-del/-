import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  db, 
  auth, 
  logInWithGoogle, 
  logOutFromFirebase, 
  isUserAdmin, 
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  BookOpen, 
  Calendar, 
  MapPin, 
  Phone, 
  Video, 
  FileText, 
  Plus, 
  Upload,
  Download,
  Trash2, 
  ChevronRight, 
  Bell, 
  Users, 
  HeartHandshake, 
  FileCheck, 
  Globe, 
  Menu, 
  X, 
  Lock, 
  Search, 
  Compass, 
  UserPlus, 
  CheckCircle2, 
  HelpCircle,
  Clock,
  ExternalLink
} from 'lucide-react';

const parseDoc = (doc: any) => {
  const data = doc.data();
  const result = { ...data };
  if (data.createdAt && typeof data.createdAt.toDate === 'function') {
    const d = data.createdAt.toDate();
    result.createdAt = d.toISOString().replace('T', ' ').substring(0, 16);
  } else if (!data.createdAt) {
    result.createdAt = new Date().toISOString().replace('T', ' ').substring(0, 16);
  }
  if (data.updatedAt && typeof data.updatedAt.toDate === 'function') {
    const d = data.updatedAt.toDate();
    result.updatedAt = d.toISOString().replace('T', ' ').substring(0, 16);
  }
  return result;
};

// === TYPE DEFINITIONS ===
interface Sermon {
  id: string;
  title: string;
  preacher: string;
  date: string;
  youtubeId: string;
  scripture: string;
}

interface Notice {
  id: string;
  category: '공지' | '소식' | '행사' | '주보';
  title: string;
  date: string;
  content: string;
  author: string;
}

interface EventSchedule {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
  desc: string;
}

interface NewcomerRegistration {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  birthDate: string;
  notes: string;
  createdAt: string;
  status: '대기' | '완료';
}

interface PrayerRequest {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  isPrivate: boolean;
}

interface Bulletin {
  id: string;
  title: string;
  date: string;
  volume: string;
  pdfUrl: string; // Base64 Data URL or transient object URL or Sample PDF Link
  fileName?: string;
  fileSize?: string;
  worshipOrder?: string; // fallback summary or manual info
  announcements?: string;
}

interface GalleryItem {
  id: string;
  title: string;
  description: string;
  imageUrl?: string; // Base64 or general URL image path
  bgClass?: string;  // Fallback styling
  date: string;
}

// Helper to compress general images to fit Firestore constraints (under 1MB) and boost speed
const compressImage = (file: File, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string); // Fallback to raw base64 if canvas is unsupported
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => {
        resolve(event.target?.result as string); // Fallback to raw base64 on error
      };
    };
    reader.onerror = () => {
      reject(new Error('파일을 읽어들이는 과정에 오류가 발생했습니다.'));
    };
  });
};

// Helper for 1:1 squared photo crop and compress to fit avatar layout
const compressAndCropToSquare = (file: File, size = 400, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string); // Fallback
          return;
        }

        let sx = 0;
        let sy = 0;
        let sWidth = img.width;
        let sHeight = img.height;

        if (img.width > img.height) {
          sWidth = img.height;
          sx = (img.width - img.height) / 2;
        } else if (img.height > img.width) {
          sHeight = img.width;
          sy = (img.height - img.width) / 2;
        }

        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => {
        resolve(event.target?.result as string); // Fallback
      };
    };
    reader.onerror = () => {
      reject(new Error('파일을 읽어들이는 과정에 오류가 발생했습니다.'));
    };
  });
};

// === MAIN APP ===
export default function App() {
  // Navigation & View States
  const [activeTab, setActiveTab] = useState<'home' | 'about' | 'word' | 'cell' | 'next' | 'mission' | 'news' | 'community' | 'admin'>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isGoogleAdminUser, setIsGoogleAdminUser] = useState<boolean>(false);
  const [adminEmails, setAdminEmails] = useState<string[]>([
    'mintjamong99@gmail.com',
    'seminary1991@gmail.com'
  ]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');
  const [missionTab, setMissionTab] = useState<'all' | 'missionary' | 'pastor' | 'support'>('all');

  // Staff states (교회를 섬기는 분들) with localStorage persistence
  const [headPastor, setHeadPastor] = useState<string>('이인영');
  const [evangelists, setEvangelists] = useState<string>('이미정 • 서보희');
  const [elders, setElders] = useState<string>('이선우 • 임종학 • 최석원');
  const [missionElders, setMissionElders] = useState<string>('장인석 • 유성천');
  const [pastorImage, setPastorImage] = useState<string>('https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=256&h=256');
  const [isDraggingPastor, setIsDraggingPastor] = useState<boolean>(false);

  // Core Data States (reloaded from localStorage if exists)
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<EventSchedule[]>([]);
  const [registrations, setRegistrations] = useState<NewcomerRegistration[]>([]);
  const [prayers, setPrayers] = useState<PrayerRequest[]>([]);
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [selectedBulletin, setSelectedBulletin] = useState<Bulletin | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [newGalleryItem, setNewGalleryItem] = useState({ title: '', description: '', imageUrl: '', date: '' });
  const [editingGalleryItem, setEditingGalleryItem] = useState<GalleryItem | null>(null);
  const [galleryFile, setGalleryFile] = useState<File | null>(null);
  const [galleryPreview, setGalleryPreview] = useState<string | null>(null);

  // Selected Active Video for Player
  const [activeVideoId, setActiveVideoId] = useState<string>('8KK022vRSh8');

  // Input states for New Register / Prayer
  const [regForm, setRegForm] = useState({ name: '', phone: '', email: '', address: '', birthDate: '', notes: '' });
  const [showRegSuccess, setShowRegSuccess] = useState(false);

  const [prayerForm, setPrayerForm] = useState({ name: '', content: '', isPrivate: false });
  const [showPrayerSuccess, setShowPrayerSuccess] = useState(false);

  // Admin CMS inputs
  const [newSermon, setNewSermon] = useState({ title: '', preacher: '이인영 담임목사', scripture: '', date: '', youtubeId: '' });
  const [newNotice, setNewNotice] = useState<Omit<Notice, 'id'>>({ category: '공지', title: '', content: '', date: '', author: '사무실' });
  const [newEvent, setNewEvent] = useState<Omit<EventSchedule, 'id'>>({ title: '', date: '', time: '', location: '', desc: '' });
  const [editingNotice, setEditingNotice] = useState<Notice | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventSchedule | null>(null);
  const [editingRegistration, setEditingRegistration] = useState<NewcomerRegistration | null>(null);
  const [editingPrayer, setEditingPrayer] = useState<PrayerRequest | null>(null);
  
  // Inline CMS states for Worship & Word Sidebar
  const [isEditingInline, setIsEditingInline] = useState(false);
  const [isAddingInline, setIsAddingInline] = useState(false);
  const [inlineSermonForm, setInlineSermonForm] = useState({ id: '', title: '', preacher: '이인영 담임목사', scripture: '', date: '', youtubeId: '' });
  const [showAdminPwPrompt, setShowAdminPwPrompt] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState('');
  const [adminPwError, setAdminPwError] = useState('');
  
  // Bulletin upload form state
  const [newBulletin, setNewBulletin] = useState({ title: '', volume: '', date: '', worshipOrder: '', announcements: '', pdfUrl: '' });
  const [bulletinFile, setBulletinFile] = useState<File | null>(null);
  const [pdfUploadError, setPdfUploadError] = useState('');
  const [pdfViewTab, setPdfViewTab] = useState<'pdf' | 'text'>('pdf');

  // Subscribe to Firebase Authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthLoading(false);
      if (firebaseUser) {
        const email = firebaseUser.email || '';
        const isEmailAdmin = isUserAdmin(email) || adminEmails.map(e => e.toLowerCase()).includes(email.toLowerCase());
        if (isEmailAdmin) {
          setIsAdminAuthenticated(true);
          setIsGoogleAdminUser(true);
        } else {
          setIsGoogleAdminUser(false);
        }
      } else {
        setIsGoogleAdminUser(false);
      }
    });
    return () => unsubscribe();
  }, [adminEmails]);

  // Sync state data in real-time with Firestore
  useEffect(() => {
    // 1. Initial default datasets for seamless bootstrapping
    const defaultSermons: Sermon[] = [
      { id: '1', title: '내게 주신 은혜를 따라', preacher: '이인영 담임목사', date: '2026-05-31', youtubeId: '8KK022vRSh8', scripture: '고린도전서 15:10' },
      { id: '2', title: '매일매일 성령 충만한 건강한 삶', preacher: '이인영 담임목사', date: '2026-05-24', youtubeId: 'W_o13651_4k', scripture: '에베소서 5:15-21' },
      { id: '3', title: '말씀 위에 든든히 서가는 믿음의 공동체', preacher: '이인영 담임목사', date: '2026-05-17', youtubeId: 'bO1D19U26lA', scripture: '사도행전 20:32' }
    ];

    const defaultNotices: Notice[] = [
      { id: '1', category: '공지', title: '2026년 여름 전교생 성경학교 교사 모집 안내', date: '2026-05-28', content: '올해 여름 다음세대(유치부, 유년부, 청소년부)의 신앙 성장을 위한 뜨거운 영적 가르침을 선사할 믿음의 교사분들을 모십니다. 많은 사명자들의 지원 바랍니다.', author: '교육부 일동' },
      { id: '2', category: '주보', title: '2026년 5월 24일자 공식 주간 주보 안내', date: '2026-05-24', content: '창립 1991년 11월 17일, 제36권 18호 스마랑 한인교회 주보가 발행되었습니다.\n\n[예배 순서 및 은혜의 말씀]\n- 은혜의 찬양과 함께 성령 충만한 예배의 자리로 성도님들을 초청합니다.\n- 예배의 부름: 오늘 이곳에 계신 성령님\n- 기도: 노현숙 권사\n- 말씀선포: 이인영 담임목사 (에베소서 5:15-21)\n- 수요예배: 수요 오전 10시 30분\n- 금요 찬양기도회: 금요일 저녁 7시 30분', author: '행정실' },
      { id: '3', category: '소식', title: '인도네시아 반둥안 산 지대 전교인 야외 단합대회 및 기도회', date: '2026-05-20', content: '성도간의 깊은 조율과 하늘이 주신 자연 속에서 연합을 꾀하기 위해, 다가오는 6월 15일에 반둥안 일원으로 수련회 및 야외 소모임 단합대회를 기획하고 있으니 함께해주시기 바랍니다.', author: '기획위원회' },
      { id: '4', category: '행사', title: '새가족 특별 성경공부 개강 안내', date: '2026-05-15', content: '인도네시아 스마랑에 처음 이주하시어 신앙생활을 시작하시는 새가족 분들을 일대일 매칭하여 신앙의 중심과 말씀의 풍족함을 나눌 성경공부 아카데미가 개설됩니다. 등록처에 신청해주세요.', author: '양육부' },
      { id: '5', category: '공지', title: '스마랑 지역 사회 선교 봉사 및 한인 구제 사역', date: '2026-05-08', content: '지역 사회에 어려움을 겪고 계시는 주민들을 돕기 위한 여름 특별 구제 봉사가 예정되어 있습니다. 자원하여 섬겨주실 청년 및 성도분들은 WhatsApp으로 신청 바랍니다.', author: '국내선교부' }
    ];

    const defaultEvents: EventSchedule[] = [
      { id: '1', title: '전교인 반둥안 단합 기도회', date: '2026-06-15', time: '오전 09:00', location: '반둥안 리조트 야외 세미나실', desc: '풍경 좋은 반둥안 산정상 지대에서 함께 드리는 예배와 뜨거운 통성 교제' },
      { id: '2', title: '정기 양육 및 제자 훈련 아카데미', date: '2026-06-08', time: '오후 02:00', location: '교회 소예배실 2층', desc: '이인영 목사님 주재로 이루어지는 기독교 기초 교리 복습 및 나눔' },
      { id: '3', title: '수요 예배 및 심야 성령 대망 희망 기도', date: '2026-06-03', time: '오전 10:30 & 오후 08:00', location: '대예배실 본당', desc: '뜨거운 말씀과 가정의 평안, 인도네시아 복음화를 위한 합심 기도회' }
    ];

    const defaultBulletins: Bulletin[] = [
      {
        id: 'b-default-1',
        title: '2026년 5월 31일 주간 주보',
        date: '2026-05-31',
        volume: '제36권 19호',
        pdfUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        fileName: 'w3c_dummy_bulletin.pdf',
        fileSize: '12.4 KB',
        worshipOrder: '예배의 부름 - 성령이 오셨네\n경배찬양 - 찬양단 다함께\n기도 - 노현숙 권사\n말씀선포 - 에베소서 5:15-21 (매일매일 성령 충만한 건강한 삶)\n축도 - 이인영 담임목사',
        announcements: '1. 새가족 특별 4주 말씀 집중 양육반 개설 안내 (오후 12:00)\n2. 중부자바 반둥안 전교인 수련회 및 야외 단합 기도회 예정'
      },
      {
        id: 'b-default-2',
        title: '2026년 5월 24일 주간 주보',
        date: '2026-05-24',
        volume: '제36권 18호',
        pdfUrl: 'https://pdfobject.com/pdf/sample.pdf',
        fileName: 'sample_bulletin_24.pdf',
        fileSize: '32.1 KB',
        worshipOrder: '예배의 부름 - 임재\n경배찬양 - 찬송가 150장\n기도 - 박영만 장로\n말씀선포 - 고린도전서 15:10\n축도 - 이인영 담임목사',
        announcements: '1. 오늘 오후 1시 구역 순장 모임 소예배실 소집\n2. 다음 세대 유치부 성경학교 교사 지원 희망 안내'
      }
    ];

    const defaultGallery: GalleryItem[] = [
      { id: 'g-3', title: '스마랑 빈민지구 구제 봉사', description: '선한 영향력으로 주 예수의 몸을 실천한 현지 빵 나눔 활동의 은혜.', bgClass: 'bg-gray-150 text-gray-700', date: '2026-05-08' }
    ];

    const defaultPrayers: PrayerRequest[] = [
      { id: 'pr-1', name: '김은자 집사', content: '인도네시아 스마랑 한인교회의 모든 가정과 자녀들의 말씀 위 든든한 정착을 소망합니다. 주눅 들지 않는 신앙 갖게 해주소서.', createdAt: '2026-05-29 18:00', isPrivate: false },
      { id: 'pr-2', name: '이인식 성도', content: '어머님 병환 차출 및 한국 치료 귀국 여정인데 성령의 인도와 치유가 닿기를 간절히 바라마지 않습니다.', createdAt: '2026-05-31 10:45', isPrivate: false }
    ];

    // 2. Attach Snapshots for Sermons
    const sermonsQuery = query(collection(db, 'sermons'), orderBy('date', 'desc'));
    const unsubscribeSermons = onSnapshot(sermonsQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultSermons.forEach(async (s) => {
          try {
            await setDoc(doc(db, 'sermons', s.id), {
              id: s.id,
              title: s.title,
              preacher: s.preacher,
              scripture: s.scripture,
              date: s.date,
              youtubeId: s.youtubeId,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(parseDoc) as Sermon[];
        setSermons(items);
      } else {
        setSermons(defaultSermons);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'sermons');
    });

    // 3. Attach Snapshots for Notices
    const noticesQuery = query(collection(db, 'notices'), orderBy('date', 'desc'));
    const unsubscribeNotices = onSnapshot(noticesQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultNotices.forEach(async (n) => {
          try {
            await setDoc(doc(db, 'notices', n.id), {
              id: n.id,
              category: n.category,
              title: n.title,
              content: n.content,
              date: n.date,
              author: n.author,
              views: 0,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(parseDoc) as Notice[];
        setNotices(items);
      } else {
        setNotices(defaultNotices);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'notices');
    });

    // 4. Attach Snapshots for Events
    const eventsQuery = query(collection(db, 'events'), orderBy('date', 'desc'));
    const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultEvents.forEach(async (ev) => {
          try {
            await setDoc(doc(db, 'events', ev.id), {
              id: ev.id,
              title: ev.title,
              date: ev.date,
              time: ev.time,
              loc: ev.location,
              desc: ev.desc || '',
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(d => {
          const parsed = parseDoc(d);
          return {
            id: parsed.id,
            title: parsed.title,
            date: parsed.date,
            time: parsed.time,
            location: parsed.loc,
            desc: parsed.desc
          };
        }) as EventSchedule[];
        setEvents(items);
      } else {
        setEvents(defaultEvents);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'events');
    });

    // 5. Attach Snapshots for Bulletins
    const bulletinsQuery = query(collection(db, 'pdf_bulletins'), orderBy('date', 'desc'));
    const unsubscribeBulletins = onSnapshot(bulletinsQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultBulletins.forEach(async (b) => {
          try {
            await setDoc(doc(db, 'pdf_bulletins', b.id), {
              id: b.id,
              title: b.title,
              date: b.date,
              pdfUrl: b.pdfUrl,
              views: 0,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(parseDoc) as Bulletin[];
        setBulletins(items);
        if (!selectedBulletin) {
          setSelectedBulletin(items[0]);
        }
      } else {
        setBulletins(defaultBulletins);
        setSelectedBulletin(defaultBulletins[0]);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'pdf_bulletins');
    });

    // 6. Attach Snapshots for Gallery
    const galleryQuery = query(collection(db, 'gallery'), orderBy('date', 'desc'));
    const unsubscribeGallery = onSnapshot(galleryQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultGallery.forEach(async (g) => {
          try {
            await setDoc(doc(db, 'gallery', g.id), {
              id: g.id,
              title: g.title,
              date: g.date,
              imageUrl: g.imageUrl || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
              remarks: g.description || '',
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(d => {
          const parsed = parseDoc(d);
          return {
            id: parsed.id,
            title: parsed.title,
            date: parsed.date,
            imageUrl: parsed.imageUrl,
            description: parsed.remarks || parsed.description || ''
          };
        }) as GalleryItem[];
        setGalleryItems(items);
      } else {
        setGalleryItems(defaultGallery);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'gallery');
    });

    // 7. Attach Snapshots for settings/staff
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'staff'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.headPastor) setHeadPastor(data.headPastor);
        if (data.evangelists) setEvangelists(data.evangelists);
        if (data.elders) setElders(data.elders);
        if (data.missionElders) setMissionElders(data.missionElders);
        if (data.pastorImage) setPastorImage(data.pastorImage);
        
        let loadedEmails = ['mintjamong99@gmail.com', 'seminary1991@gmail.com'];
        if (data.adminEmails && Array.isArray(data.adminEmails)) {
          setAdminEmails(data.adminEmails);
          loadedEmails = data.adminEmails;
        }
        
        const currentUser = auth.currentUser;
        if (currentUser) {
          const email = currentUser.email || '';
          const isEmailAdmin = isUserAdmin(email) || loadedEmails.map(e => e.toLowerCase()).includes(email.toLowerCase());
          if (isEmailAdmin) {
            setIsAdminAuthenticated(true);
            setIsGoogleAdminUser(true);
          } else {
            setIsGoogleAdminUser(false);
          }
        }
      } else if (isAdminAuthenticated) {
        setDoc(doc(db, 'settings', 'staff'), {
          id: 'staff',
          headPastor: '이인영',
          evangelists: '이미정 • 서보희',
          elders: '이선우 • 임종학 • 최석원',
          missionElders: '장인석 • 유성천',
          pastorImage: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=256&h=256',
          adminEmails: ['mintjamong99@gmail.com', 'seminary1991@gmail.com'],
          updatedAt: serverTimestamp()
        }).catch(console.error);
      }
    }, (err) => {
      // settings read failure is benign, fall back to defaults silently
      console.warn("Settings fetch failed or unauthorized:", err);
    });

    // 8. Attach Snapshots for Prayers
    const prayersQuery = query(collection(db, 'prayers'), orderBy('createdAt', 'desc'));
    const unsubscribePrayers = onSnapshot(prayersQuery, (snapshot) => {
      if (snapshot.empty && isAdminAuthenticated) {
        defaultPrayers.forEach(async (pr) => {
          try {
            await setDoc(doc(db, 'prayers', pr.id), {
              id: pr.id,
              title: '중보기도 제목',
              author: pr.name,
              content: pr.content,
              date: new Date().toISOString().slice(0, 10),
              isPrivate: pr.isPrivate || false,
              praises: 0,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else if (!snapshot.empty) {
        const items = snapshot.docs.map(d => {
          const parsed = parseDoc(d);
          return {
            id: parsed.id,
            name: parsed.author,
            content: parsed.content,
            createdAt: parsed.createdAt,
            isPrivate: parsed.isPrivate || false
          };
        }) as PrayerRequest[];
        // Filter private items client-side securely if not admin
        if (isAdminAuthenticated) {
          setPrayers(items);
        } else {
          setPrayers(items.filter(p => !p.isPrivate));
        }
      } else {
        setPrayers(defaultPrayers);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'prayers');
    });

    return () => {
      unsubscribeSermons();
      unsubscribeNotices();
      unsubscribeEvents();
      unsubscribeBulletins();
      unsubscribeGallery();
      unsubscribeSettings();
      unsubscribePrayers();
    };
  }, [isAdminAuthenticated]);

  // Sync Registrations in real-time only if Admin is authenticated (Secure Attribute Check)
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    const defaultRegistrations: NewcomerRegistration[] = [
      { id: 'reg-1', name: '민정우', phone: '+62 812-3456-7890', email: 'jungwoo@gmail.com', address: 'Jl. Pemuda No.45, Semarang Tengah', birthDate: '1995-11-12', notes: '자카르타에서 이번 달에 인도네시아 스마랑 지사로 발령받아 이사 온 청년입니다. 교제와 예배 말씀 위에 견고해지고 싶습니다.', createdAt: '2026-05-29 14:20', status: '완료' },
      { id: 'reg-2', name: '이하은', phone: '+62 821-9988-7766', email: 'haeun99@naver.com', address: 'Jl. Sultan Agung Apartment Green Hills Room 802', birthDate: '1998-04-05', notes: '스마랑에서 대학 연구원으로 1년 거주 예정입니다. 주일 2부 대예배 참석하고 교제 나누고 싶어요!', createdAt: '2026-05-30 09:12', status: '대기' }
    ];

    const registrationsQuery = query(collection(db, 'registrations'), orderBy('createdAt', 'desc'));
    const unsubscribeRegs = onSnapshot(registrationsQuery, (snapshot) => {
      if (snapshot.empty) {
        defaultRegistrations.forEach(async (r) => {
          try {
            await setDoc(doc(db, 'registrations', r.id), {
              id: r.id,
              name: r.name,
              phone: r.phone,
              dept: '새가족부',
              remark: r.notes || '',
              date: r.createdAt.substring(0, 10),
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error(e);
          }
        });
      } else {
        const items = snapshot.docs.map(d => {
          const parsed = parseDoc(d);
          return {
            id: parsed.id,
            name: parsed.name,
            phone: parsed.phone,
            email: parsed.email || '',
            address: parsed.address || '',
            birthDate: parsed.birthDate || '',
            notes: parsed.remark || '',
            createdAt: parsed.createdAt,
            status: parsed.status || '대기'
          };
        }) as NewcomerRegistration[];
        setRegistrations(items);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'registrations');
    });

    return () => unsubscribeRegs();
  }, [isAdminAuthenticated]);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === 'semarang1991' || adminPassword === '1234') {
      setIsAdminAuthenticated(true);
      setIsGoogleAdminUser(false);
      setAdminLoginError('');
    } else {
      setAdminLoginError('올바른 비밀번호를 입력해 주세요. (가이드: semarang1991)');
    }
  };

  const handleAdminLogout = async () => {
    try {
      await logOutFromFirebase();
    } catch (e) {
      console.error(e);
    }
    setIsAdminAuthenticated(false);
    setIsGoogleAdminUser(false);
  };

  const checkMutationPermission = (): boolean => {
    if (!isAdminAuthenticated) {
      alert('관리자 권한을 위한 로그인이 되어 있지 않습니다.');
      return false;
    }
    if (!isGoogleAdminUser) {
      alert('⚠️ 수정/삭제 권한이 없습니다.\n\n정정과 삭제는 등록된 Google 시스템 관리자만 가능합니다. "Google 관리자 계정으로 로그인"을 해주십시오. (현재 일반 조회 모드로 보기만 가능합니다.)');
      return false;
    }
    return true;
  };

  const handleAddAdminEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    
    const emailToRegister = newAdminEmail.trim().toLowerCase();
    if (!emailToRegister) return;
    
    if (!emailToRegister.includes('@')) {
      alert('올바른 이메일 형식이 아닙니다.');
      return;
    }
    
    if (adminEmails.map(email => email.toLowerCase()).includes(emailToRegister)) {
      alert('이미 관리자로 등록되어 있는 이메일입니다.');
      return;
    }
    
    if (adminEmails.length >= 5) {
      alert('관리자는 최대 5명까지만 설정할 수 있습니다.');
      return;
    }
    
    const updatedEmails = [...adminEmails, emailToRegister];
    
    try {
      await setDoc(doc(db, 'settings', 'staff'), {
        adminEmails: updatedEmails
      }, { merge: true });
      setAdminEmails(updatedEmails);
      setNewAdminEmail('');
      alert(`[${emailToRegister}] 계정이 관리자로 등록되었습니다. 이제 Firestore 규칙을 활용해 정정 및 삭제를 실시간 권한 동기화할 수 있습니다.`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/staff');
    }
  };

  const handleRemoveAdminEmail = async (emailToRemove: string) => {
    if (!checkMutationPermission()) return;
    
    const lowerRemove = emailToRemove.toLowerCase();
    if (lowerRemove === 'mintjamong99@gmail.com') {
      alert('시스템 소유자(mintjamong99@gmail.com) 계정은 권한 삭제할 수 없습니다.');
      return;
    }
    
    if (!confirm(`[${emailToRemove}] 계정을 관리자 목록에서 삭제하시겠습니까?`)) {
      return;
    }
    
    const updatedEmails = adminEmails.filter(email => email.toLowerCase() !== lowerRemove);
    try {
      await setDoc(doc(db, 'settings', 'staff'), {
        adminEmails: updatedEmails
      }, { merge: true });
      setAdminEmails(updatedEmails);
      alert('관리자 계정이 목록에서 제거되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/staff');
    }
  };

  // Submit Register Form
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regForm.name || !regForm.phone) {
      alert('이름과 연락처는 필수 기입 사항입니다.');
      return;
    }
    try {
      const docId = 'reg-' + Date.now();
      await setDoc(doc(db, 'registrations', docId), {
        id: docId,
        name: regForm.name,
        phone: regForm.phone,
        email: regForm.email || '',
        address: regForm.address || '',
        birthDate: regForm.birthDate || '',
        remark: regForm.notes || '',
        dept: '새가족부',
        status: '대기',
        createdAt: serverTimestamp()
      });
      setShowRegSuccess(true);
      setRegForm({ name: '', phone: '', email: '', address: '', birthDate: '', notes: '' });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'registrations');
    }
  };

  // Submit Prayer Request
  const handlePrayerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prayerForm.content) {
      alert('기도 요청 내용을 작성해 주세요.');
      return;
    }
    try {
      const docId = 'pr-' + Date.now();
      await setDoc(doc(db, 'prayers', docId), {
        id: docId,
        title: '중보기도 제목',
        author: prayerForm.name || '무명 청원자',
        content: prayerForm.content,
        date: new Date().toISOString().slice(0, 10),
        isPrivate: prayerForm.isPrivate,
        praises: 0,
        createdAt: serverTimestamp()
      });
      setShowPrayerSuccess(true);
      setPrayerForm({ name: '', content: '', isPrivate: false });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'prayers');
    }
  };

  // Admin Actions
  const handleAddSermon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!newSermon.title || !newSermon.youtubeId) {
      alert('설교 제목과 유튜브 비디오 ID는 필수 항목입니다.');
      return;
    }
    try {
      const docId = 's-' + Date.now();
      await setDoc(doc(db, 'sermons', docId), {
        id: docId,
        title: newSermon.title,
        preacher: newSermon.preacher,
        scripture: newSermon.scripture || '본문 자료 없음',
        date: newSermon.date || new Date().toISOString().slice(0, 10),
        youtubeId: newSermon.youtubeId,
        createdAt: serverTimestamp()
      });
      setNewSermon({ title: '', preacher: '이인영 담임목사', scripture: '', date: '', youtubeId: '' });
      alert('새로운 설교 말씀이 홈페이지에 반영되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'sermons');
    }
  };

  const handleDeleteSermon = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('해당 설교자료를 삭제할까요?')) {
      try {
        await deleteDoc(doc(db, 'sermons', id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `sermons/${id}`);
      }
    }
  };

  const handleStartInlineEdit = (sermon: Sermon) => {
    setInlineSermonForm({
      id: sermon.id,
      title: sermon.title,
      preacher: sermon.preacher,
      scripture: sermon.scripture,
      date: sermon.date,
      youtubeId: sermon.youtubeId
    });
    setIsEditingInline(true);
    setIsAddingInline(false);
  };

  const handleStartInlineAdd = () => {
    setInlineSermonForm({
      id: '',
      title: '',
      preacher: '이인영 담임목사',
      scripture: '',
      date: new Date().toISOString().slice(0, 10),
      youtubeId: ''
    });
    setIsAddingInline(true);
    setIsEditingInline(false);
  };

  const handleSaveInlineEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!inlineSermonForm.title || !inlineSermonForm.youtubeId) {
      alert('설교 제목과 유튜브 비디오 ID는 필수 항목입니다.');
      return;
    }
    try {
      await updateDoc(doc(db, 'sermons', inlineSermonForm.id), {
        title: inlineSermonForm.title,
        preacher: inlineSermonForm.preacher,
        scripture: inlineSermonForm.scripture,
        date: inlineSermonForm.date,
        youtubeId: inlineSermonForm.youtubeId
      });
      setActiveVideoId(inlineSermonForm.youtubeId);
      setIsEditingInline(false);
      alert('설교 말씀 수정이 저장되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `sermons/${inlineSermonForm.id}`);
    }
  };

  const handleSaveInlineAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!inlineSermonForm.title || !inlineSermonForm.youtubeId) {
      alert('설교 제목과 유튜브 비디오 ID는 필수 항목입니다.');
      return;
    }
    try {
      const docId = 's-' + Date.now();
      await setDoc(doc(db, 'sermons', docId), {
        id: docId,
        title: inlineSermonForm.title,
        preacher: inlineSermonForm.preacher,
        scripture: inlineSermonForm.scripture || '본문 자료 없음',
        date: inlineSermonForm.date || new Date().toISOString().slice(0, 10),
        youtubeId: inlineSermonForm.youtubeId,
        createdAt: serverTimestamp()
      });
      setActiveVideoId(inlineSermonForm.youtubeId);
      setIsAddingInline(false);
      alert('새로운 설교 말씀이 연동 등록되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'sermons');
    }
  };

  const handleInlineAdminAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPwInput === 'semarang1991' || adminPwInput === '1234') {
      setIsAdminAuthenticated(true);
      setShowAdminPwPrompt(false);
      setAdminPwInput('');
      setAdminPwError('');
    } else {
      setAdminPwError('비밀번호가 올바르지 않습니다.');
    }
  };

  const handleDeleteInlineSermon = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!checkMutationPermission()) return;
    if (!window.confirm('정말로 이 설교 말씀을 삭제하시겠습니까?')) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'sermons', id));
      const wasActive = sermons.find(s => s.id === id)?.youtubeId === activeVideoId;
      if (wasActive) {
        const remaining = sermons.filter(s => s.id !== id);
        if (remaining.length > 0) {
          setActiveVideoId(remaining[0].youtubeId);
        }
      }
      alert('설교 말씀이 삭제되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `sermons/${id}`);
    }
  };

  const handleAddNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!newNotice.title || !newNotice.content) {
      alert('제목과 상세 내용은 필수입니다.');
      return;
    }
    try {
      const docId = 'n-' + Date.now();
      await setDoc(doc(db, 'notices', docId), {
        id: docId,
        category: newNotice.category,
        title: newNotice.title,
        content: newNotice.content,
        date: newNotice.date || new Date().toISOString().slice(0, 10),
        author: newNotice.author,
        views: 0,
        createdAt: serverTimestamp()
      });
      setNewNotice({ category: '공지', title: '', content: '', date: '', author: '사무실' });
      alert('교회 소식이 신규 업로드되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'notices');
    }
  };

  const handleDeleteNotice = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('해당 알림글을 제거하겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'notices', id));
        if (editingNotice?.id === id) {
          setEditingNotice(null);
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `notices/${id}`);
      }
    }
  };

  const handleSaveNoticeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!editingNotice) return;
    if (!editingNotice.title || !editingNotice.content) {
      alert('제목과 상세 내용은 필수입니다.');
      return;
    }
    try {
      await updateDoc(doc(db, 'notices', editingNotice.id), {
        category: editingNotice.category,
        title: editingNotice.title,
        content: editingNotice.content,
        date: editingNotice.date,
        author: editingNotice.author
      });
      setEditingNotice(null);
      alert('교회 소식 내용이 정확하게 정정되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `notices/${editingNotice.id}`);
    }
  };

  const handleUploadBulletin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!newBulletin.title) {
      alert('주보 제목 및 일자를 정확하게 작명해 주십시오.');
      return;
    }

    const saveBulletin = async (dataUrl: string) => {
      try {
        const docId = 'b-' + Date.now();
        await setDoc(doc(db, 'pdf_bulletins', docId), {
          id: docId,
          title: newBulletin.title,
          date: newBulletin.date || new Date().toISOString().slice(0, 10),
          pdfUrl: dataUrl || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
          views: 0,
          createdAt: serverTimestamp()
        });
        
        // Reset
        setNewBulletin({ title: '', volume: '', date: '', worshipOrder: '', announcements: '', pdfUrl: '' });
        setBulletinFile(null);
        alert('✅ 매주 주보 파일이 보관소에 성공적으로 등록되었습니다!');
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, 'pdf_bulletins');
      }
    };

    if (bulletinFile) {
      if (bulletinFile.type.startsWith('image/')) {
        // Automatically compress image file (max 1000x1500, quality 0.7) to keep it under 500KB
        compressImage(bulletinFile, 1000, 1500, 0.7)
          .then((compressedData) => {
            saveBulletin(compressedData);
          })
          .catch((err) => {
            console.error(err);
            alert('❌ 이미지 압축 중 에러가 발생했습니다. 다른 파일을 등록해 주세요.');
          });
      } else {
        // Handle PDF file size checking (Firestore document limit 1MB, Base64 adds ~33% size)
        const fileSizeInMB = bulletinFile.size / (1024 * 1024);
        if (fileSizeInMB > 0.70) {
          alert(`⚠️ PDF 파일의 용량이 불일치합니다 (현재 파일 크기: ${fileSizeInMB.toFixed(2)}MB).\n\nFirestore 클라우드 데이터베이스의 단일 문서 용량 제한(1MB) 및 Base64 인코딩 추가 용량 증적으로 인해 실제 용량이 0.7MB(700KB) 이하인 PDF 파일만 직접 실시간 등록이 가능합니다.\n\n해결방법:\n1. 'iLovePDF' 또는 'Adobe Acrobat PDF 압축' 등의 무료 온라인 서비스를 이용하여 PDF 용량을 0.7MB 이하로 압축한 뒤 올려주세요.\n2. 혹은 주보의 해상도를 낮춰서 스캔 후 업로드해주세요.\n3. 또는 주보를 이미지 파일(JPG, PNG)로 캡처·저장하여 선택하시면 고용량 이미지라도 시스템에서 초경량(Web-Optimized)으로 실시간 자동 압축하여 반영됩니다!`);
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          saveBulletin(event.target?.result as string);
        };
        reader.readAsDataURL(bulletinFile);
      }
    } else {
      saveBulletin('');
    }
  };

  const handleDeleteBulletin = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('선택하신 주간 주보를 보관소에서 삭제하시겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'pdf_bulletins', id));
        if (selectedBulletin?.id === id) {
          setSelectedBulletin(null);
        }
        alert('주보 삭제가 완료되었습니다.');
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `pdf_bulletins/${id}`);
      }
    }
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!newEvent.title || !newEvent.date) {
      alert('행사 명명과 날짜 입력은 필수입니다.');
      return;
    }
    try {
      const docId = 'e-' + Date.now();
      await setDoc(doc(db, 'events', docId), {
        id: docId,
        title: newEvent.title,
        date: newEvent.date,
        time: newEvent.time || '종일 행사',
        loc: newEvent.location || '교회 본관',
        desc: newEvent.desc || '',
        createdAt: serverTimestamp()
      });
      setNewEvent({ title: '', date: '', time: '', location: '', desc: '' });
      alert('캘린더 일정에 행사가 추가되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'events');
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('해당 행사 구역을 철회할까요?')) {
      try {
        await deleteDoc(doc(db, 'events', id));
        if (editingEvent?.id === id) {
          setEditingEvent(null);
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `events/${id}`);
      }
    }
  };

  const handleSaveEventEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!editingEvent) return;
    if (!editingEvent.title || !editingEvent.date) {
      alert('행사 명칭과 날짜 입력은 필수입니다.');
      return;
    }
    try {
      await updateDoc(doc(db, 'events', editingEvent.id), {
        title: editingEvent.title,
        date: editingEvent.date,
        time: editingEvent.time,
        loc: editingEvent.location,
        desc: editingEvent.desc || ''
      });
      setEditingEvent(null);
      alert('캘린더 일정 내용이 정확하게 정정되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${editingEvent.id}`);
    }
  };

  const handleGalleryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setGalleryFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setGalleryPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setGalleryPreview(null);
    }
  };

  const handleAddGalleryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!newGalleryItem.title) {
      alert('사진 제목은 필수 항목입니다.');
      return;
    }

    try {
      let compressedData = '';
      if (galleryFile) {
        compressedData = await compressImage(galleryFile, 800, 800, 0.7);
      }

      const docId = 'g-' + Date.now();
      await setDoc(doc(db, 'gallery', docId), {
        id: docId,
        title: newGalleryItem.title,
        remarks: newGalleryItem.description || '상세 사역 기록 소개 없음',
        imageUrl: compressedData || newGalleryItem.imageUrl || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2',
        createdAt: serverTimestamp(),
        date: newGalleryItem.date || new Date().toISOString().slice(0, 10)
      });
      setNewGalleryItem({ title: '', description: '', imageUrl: '', date: '' });
      setGalleryFile(null);
      setGalleryPreview(null);
      alert('새로운 사진록이 연동 등록되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'gallery');
    }
  };

  const handleDeleteGalleryItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!checkMutationPermission()) return;
    if (confirm('이 사진 기록을 삭제하시겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'gallery', id));
        if (editingGalleryItem?.id === id) {
          setEditingGalleryItem(null);
        }
        alert('사진 기록이 영구 삭제되었습니다.');
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `gallery/${id}`);
      }
    }
  };

  const handleSaveGalleryItemEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    if (!editingGalleryItem) return;
    if (!editingGalleryItem.title) {
      alert('사진 제목은 필수 항목입니다.');
      return;
    }

    try {
      let compressedData = '';
      if (galleryFile) {
        compressedData = await compressImage(galleryFile, 800, 800, 0.7);
      }

      await updateDoc(doc(db, 'gallery', editingGalleryItem.id), {
        title: editingGalleryItem.title,
        remarks: editingGalleryItem.description || '상세 사역 기록 소개 없음',
        imageUrl: compressedData || editingGalleryItem.imageUrl || '',
        date: editingGalleryItem.date || new Date().toISOString().slice(0, 10)
      });
      setEditingGalleryItem(null);
      setGalleryFile(null);
      setGalleryPreview(null);
      alert('교회 추억 사진록 내용 정정이 정상 저장되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `gallery/${editingGalleryItem.id}`);
    }
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkMutationPermission()) return;
    try {
      await setDoc(doc(db, 'settings', 'staff'), {
        id: 'staff',
        headPastor,
        evangelists,
        elders,
        missionElders,
        pastorImage,
        adminEmails,
        updatedAt: serverTimestamp()
      }, { merge: true });
      alert('교회 섬기는 분들의 명단 정보가 정상적으로 저장/웹페이지에 반영되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/staff');
    }
  };

  const handlePastorFileSelect = async (file: File) => {
    if (!checkMutationPermission()) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    try {
      // Crop to 1:1 and compress (max 256x256, JPEG quality 0.7)
      const compressedData = await compressAndCropToSquare(file, 256, 0.7);
      setPastorImage(compressedData);
      
      await setDoc(doc(db, 'settings', 'staff'), {
        id: 'staff',
        headPastor,
        evangelists,
        elders,
        missionElders,
        pastorImage: compressedData,
        adminEmails,
        updatedAt: serverTimestamp()
      }, { merge: true });
      alert('담임목사님 사진이 규격(1:1)에 맞게 실시간 업로드 및 동기화되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings/staff');
    }
  };

  const handleToggleRegStatus = async (id: string) => {
    if (!checkMutationPermission()) return;
    const registration = registrations.find(r => r.id === id);
    if (!registration) return;
    const newStatus = registration.status === '대기' ? '완료' : '대기';
    try {
      await updateDoc(doc(db, 'registrations', id), {
        status: newStatus
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `registrations/${id}`);
    }
  };

  const handleDeleteReg = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('새가족 신청 명단을 메인 기록에서 완전히 삭제할까요?')) {
      try {
        await deleteDoc(doc(db, 'registrations', id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `registrations/${id}`);
      }
    }
  };

  const handleSaveRegistrationEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRegistration) return;
    if (!checkMutationPermission()) return;
    try {
      await updateDoc(doc(db, 'registrations', editingRegistration.id), {
        name: editingRegistration.name,
        phone: editingRegistration.phone,
        email: editingRegistration.email || '',
        address: editingRegistration.address || '',
        birthDate: editingRegistration.birthDate || '',
        remark: editingRegistration.notes || '',
        status: editingRegistration.status || '대기'
      });
      setEditingRegistration(null);
      alert('새가족 정보가 성공적으로 정정되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `registrations/${editingRegistration.id}`);
    }
  };

  const handleSavePrayerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrayer) return;
    if (!checkMutationPermission()) return;
    try {
      await updateDoc(doc(db, 'prayers', editingPrayer.id), {
        author: editingPrayer.author,
        content: editingPrayer.content,
        isPrivate: editingPrayer.isPrivate
      });
      setEditingPrayer(null);
      alert('중보기도 내용이 성공적으로 수정되었습니다.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `prayers/${editingPrayer.id}`);
    }
  };

  const handleDeletePrayer = async (id: string) => {
    if (!checkMutationPermission()) return;
    if (confirm('이 중보기도를 메인 목록에서 완전히 삭제하시겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'prayers', id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `prayers/${id}`);
      }
    }
  };

  // SVG Logo of Semarang Korean Church (Perfect reproduction of the paper bulletin logo)
  const ChurchLogo = ({ className = 'w-10 h-10' }) => (
    <svg className={className} viewBox="0 0 450 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background Mountain Shapes (Representing Mount Bandungan) */}
      <polygon points="10,120 70,30 130,120" fill="#2D5A27" />
      <polygon points="80,120 130,50 180,120" fill="#1b3d17" />
      
      {/* Cross in the Center of Mountains */}
      <line x1="120" y1="10" x2="120" y2="120" stroke="#f6ad55" strokeWidth="8" strokeLinecap="round" />
      <line x1="90" y1="45" x2="150" y2="45" stroke="#f6ad55" strokeWidth="8" strokeLinecap="round" />
      
      {/* City/Church Building Pillars on the Right side */}
      <rect x="195" y="60" width="16" height="60" fill="#2C3E50" rx="3" />
      <rect x="215" y="30" width="16" height="90" fill="#2D5A27" rx="3" />
      
      {/* Ground horizon line */}
      <line x1="0" y1="120" x2="245" y2="120" stroke="#2C3E50" strokeWidth="4" />
      
      {/* Traditional Calligraphy text (translated to Vector text mockup or semantic rendering path in HTML) */}
      <text x="5" y="145" fontFamily="Georgia, serif" fontSize="22" fontWeight="bold" fill="#2D5A27" letterSpacing="2">스마랑 한인교회</text>
      <text x="5" y="158" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="bold" fill="#718096" letterSpacing="1">KOREAN CHRISTIAN COMMUNITY IN CENTRAL JAVA</text>
    </svg>
  );

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-[#2C3E50] font-sans antialiased flex flex-col selection:bg-[#2D5A27]/20 selection:text-[#2D5A27]">
      
      {/* UPPER RUNNING BANNER: CHURCH COVENANT */}
      <div className="bg-[#2D5A27] text-white py-2 px-4 shadow-inner text-xs font-serif overflow-hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-1">
          <p className="font-semibold tracking-wider text-center sm:text-left flex items-center gap-2">
            <span className="text-[#F6AD55] bg-white/10 px-2 py-0.5 rounded text-[10px] uppercase font-sans font-bold">창립 1991.11.17</span>
          </p>
          <p className="text-[#FFF9E5] text-[11px] font-light text-center sm:text-right italic">
            "지금 내가 너희를 주와 및 그 은혜의 말씀깨 부탁하노니 그 말씀이 너희를 능히 든든히 세우사 거룩케 하심을 입은 모든 자 가운데 기업이 있게 하시리라(행 20:32)"
          </p>
        </div>
      </div>

      {/* HEADER / NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-[#E2E8F0] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          
          {/* Logo Brand */}
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setActiveTab('home'); setMobileMenuOpen(false); }}>
            <div className="w-[200px] sm:w-[260px] h-[72px] sm:h-[92px] overflow-visible flex items-center">
              <ChurchLogo className="w-full h-full" />
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
            {[
              { id: 'home', label: 'HOME' },
              { id: 'about', label: '교회소개' },
              { id: 'word', label: '예배와 말씀' },
              { id: 'cell', label: '순공동체' },
              { id: 'next', label: '다음세대' },
              { id: 'mission', label: '선교' },
              { id: 'news', label: '교회소식' },
              { id: 'community', label: '교제와 나눔' },
            ].map((menu) => (
              <button
                key={menu.id}
                id={`btn-nav-${menu.id}`}
                onClick={() => setActiveTab(menu.id as any)}
                className={`py-2 px-3 xl:px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  activeTab === menu.id 
                    ? 'bg-[#2D5A27] text-white shadow-sm'
                    : 'text-gray-600 hover:text-[#2D5A27] hover:bg-gray-50'
                }`}
              >
                {menu.label}
              </button>
            ))}
          </nav>

          {/* Practical Side Action: Admin Quick link */}
          <div className="hidden lg:flex items-center gap-3">
            <button
              id="btn-admin-nav"
              onClick={() => setActiveTab('admin')}
              className={`p-2 rounded-xl border flex items-center gap-1.5 transition-all text-xs font-semibold ${
                activeTab === 'admin'
                  ? 'border-[#2D5A27] bg-[#2D5A27]/5 text-[#2D5A27]'
                  : 'border-gray-200 hover:border-gray-300 text-gray-500'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              관리자
            </button>
          </div>

          {/* Mobile Menu Action Trigger */}
          <div className="flex items-center gap-3 lg:hidden">
            <button
              id="btn-mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-gray-600 hover:text-[#2D5A27] hover:bg-gray-100 rounded-lg"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>
      </header>

      {/* MOBILE DRAWER NAVIGATION */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
          <div 
            className="absolute top-[83px] left-0 right-0 bg-white shadow-xl border-b border-gray-200 p-5 flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {[
              { id: 'home', label: 'HOME (종합 대시보드)' },
              { id: 'about', label: '교회소개' },
              { id: 'word', label: '예배와 말씀' },
              { id: 'cell', label: '순공동체' },
              { id: 'next', label: '다음세대' },
              { id: 'mission', label: '선교와 사역' },
              { id: 'news', label: '교회소식 / 주보' },
              { id: 'community', label: '교제와 나눔 / 기도요청' },
              { id: 'admin', label: '목회자/사무간사 관리자' },
            ].map((menu) => (
              <button
                key={menu.id}
                id={`btn-mobile-nav-${menu.id}`}
                onClick={() => {
                  setActiveTab(menu.id as any);
                  setMobileMenuOpen(false);
                }}
                className={`w-full py-3 px-4 rounded-xl text-left text-sm font-semibold transition-all ${
                  activeTab === menu.id 
                    ? 'bg-[#2D5A27]/10 text-[#2D5A27] border-l-4 border-[#2D5A27]'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {menu.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAIN VIEW CONTROLLER */}
      <main className="flex-grow">
        
        {/* ===================================== */}
        {/* TAB 1: HOME (BENTO GRID REPRESENTATION) */}
        {/* ===================================== */}
        {activeTab === 'home' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              
              {/* BENTO BLOCK 1: MAIN VISION & HIGHLIGHT (Bandungan Backdrop) */}
              <div 
                id="bento-vision"
                className="md:col-span-12 bg-gradient-to-br from-[#1a3818] via-[#2D5A27] to-[#122A10] rounded-3xl p-6 sm:p-10 text-white relative overflow-hidden shadow-lg border border-emerald-950 flex flex-col justify-between min-h-[360px]"
              >


                <div className="relative z-10 flex flex-col justify-start items-start gap-3">
                  <span className="text-[#F6AD55] bg-white/10 text-[10px] sm:text-xs font-bold tracking-[0.2em] px-3 py-1 rounded-full uppercase">
                    스마랑 한인교회 표어
                  </span>
                  <p className="text-[#FFF9E5] text-sm italic border-b border-white/20 pb-2">"우리는 예수님의 제자입니다"</p>
                </div>

                <div className="relative z-10 my-6">
                  <h2 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold leading-tight tracking-wide text-white drop-shadow-md">
                    말씀위에<br/>
                    <span className="text-[#FFF9E5]">든든히 서가는</span> "스마랑 한인교회"
                  </h2>
                </div>

                <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 pt-4 border-t border-white/10">
                  <p 
                    className="text-gray-200 max-w-xl leading-relaxed"
                    style={{ width: '573px', height: '51.5px', fontSize: '15px' }}
                  >
                    스마랑 한인 교회는 예배, 선교, 성령, 사랑의 공동체로 다음세대를 세우고 중부 자와 스마랑 땅의 한인 복음화를 위해 오직 예수님만 증거하는 건강한 교회입니다.
                  </p>
                  <button 
                    onClick={() => setActiveTab('about')}
                    className="bg-white/10 hover:bg-white/20 text-white border border-white/30 text-xs font-bold py-2.5 px-4 rounded-xl transition-all flex items-center gap-1 shrink-0"
                  >
                    우리교회 소개 <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* BENTO BLOCK 3: VIDEO PLAYER AREA (YouTube integration) */}
              <div 
                id="bento-sermon"
                className="md:col-span-6 bg-[#1A202C] border border-gray-800 rounded-3xl p-5 sm:p-6 text-white flex flex-col justify-between shadow-md"
              >
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-red-500" />
                    <h3 className="text-gray-200 font-bold text-sm">최신 예배 설교 말씀</h3>
                  </div>
                  <a 
                    href="https://www.youtube.com/@%EC%8A%A4%EB%A7%88%EB%9E%91%ED%95%9C%EC%9D%B8%EA%B5%90%ED%9A%8C"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-red-400 hover:text-red-300 font-bold flex items-center gap-1 bg-red-500/10 px-2.5 py-1 rounded-lg border border-red-500/20"
                  >
                    공식 채널 바로가기 <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Simulated/Real YouTube Player Embed */}
                <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-gray-800 mb-3 group shadow-inner">
                  <iframe 
                    className="absolute inset-0 w-full h-full"
                    src={`https://www.youtube.com/embed/${activeVideoId}`}
                    title="Sermon Player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>

                {/* Scripture & Title detail box */}
                <div className="pt-1">
                  <p className="text-xs text-emerald-400 font-medium">
                    {sermons.find(s => s.youtubeId === activeVideoId)?.scripture || '본문: 에베소서 5:15-21'}
                  </p>
                  <h4 className="text-sm font-bold text-white mt-0.5 line-clamp-1">
                    {sermons.find(s => s.youtubeId === activeVideoId)?.title || '매일매일 성령 충만한 건강한 삶'}
                  </h4>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-800">
                    <span className="text-[11px] text-gray-400">인도: 이인영 담임목사</span>
                    <button 
                      onClick={() => setActiveTab('word')}
                      className="text-xs text-[#FFF9E5] hover:underline flex items-center gap-0.5"
                    >
                      설교 말씀 더보기 +
                    </button>
                  </div>
                </div>
              </div>

              {/* BENTO BLOCK 4: WORSHIP SCHEDULE SCHEDULE (Essential item in image) */}
              <div 
                id="bento-schedule"
                className="md:col-span-6 bg-white border border-[#E2E8F0] rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="font-bold text-[#2D5A27] text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      스마랑 예배 시간표 안내
                    </h3>
                    <span className="text-[10px] text-gray-400">주일 및 중주중 집회</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-[#2D5A27]/5 border border-[#2D5A27]/10 flex flex-col justify-between">
                      <div className="flex justify-between items-start w-full">
                        <span className="text-xs font-bold text-gray-700">주일 1부 예배</span>
                        <span className="text-[9px] bg-[#2D5A27]/10 text-[#2D5A27] px-1.5 py-0.5 rounded font-bold">소예배실</span>
                      </div>
                      <span className="text-[#2D5A27] font-semibold text-xs mt-1.5">주일 오전 8:30</span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#2D5A27]/5 border border-[#2D5A27]/10 flex flex-col justify-between">
                      <div className="flex justify-between items-start w-full">
                        <span className="text-xs font-bold text-gray-700">주일 2부 예배</span>
                        <span className="text-[9px] bg-[#2D5A27]/10 text-[#2D5A27] px-1.5 py-0.5 rounded font-bold">대예배실</span>
                      </div>
                      <span className="text-[#2D5A27] font-semibold text-xs mt-1.5">주일 오전 10:00</span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#2D5A27]/5 border border-[#2D5A27]/10 flex flex-col justify-between">
                      <div className="flex justify-between items-start w-full">
                        <span className="text-xs font-bold text-gray-700">수요 예배</span>
                        <span className="text-[9px] bg-[#2D5A27]/10 text-[#2D5A27] px-1.5 py-0.5 rounded font-bold">대예배실</span>
                      </div>
                      <span className="text-[#2D5A27] font-semibold text-xs mt-1.5">수요일 오전 10:30</span>
                    </div>

                    <div className="p-3 rounded-xl bg-[#2D5A27]/5 border border-[#2D5A27]/10 flex flex-col justify-between">
                      <div className="flex justify-between items-start w-full">
                        <span className="text-xs font-bold text-gray-700">금요 찬양기도회</span>
                        <span className="text-[9px] bg-[#2D5A27]/10 text-[#2D5A27] px-1.5 py-0.5 rounded font-bold">대예배실</span>
                      </div>
                      <span className="text-[#2D5A27] font-semibold text-xs mt-1.5">금요일 오후 7:30</span>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200/60 flex items-center justify-between col-span-1 sm:col-span-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-gray-700">새벽 기도</span>
                        <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">대예배실</span>
                      </div>
                      <span className="text-amber-800 font-bold text-xs">월~금 오전 5:00</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <p className="text-[10px] text-gray-400">※ 주일학교, 기도회, 모임 등 전체 가이드는 아래 소개를 확인하세요.</p>
                  <button 
                    onClick={() => setActiveTab('about')}
                    className="text-xs text-[#2D5A27] hover:underline font-bold flex items-center gap-0.5 self-end"
                  >
                    전체 모임 시간표 보기 <ChevronRight className="inline w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* BENTO BLOCK 5: NOTICES / ANNOUNCEMENTS (With CMS real response) */}
              <div 
                id="bento-notices"
                className="md:col-span-12 bg-white border border-[#E2E8F0] rounded-3xl p-6 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-[#2D5A27] text-sm flex items-center gap-1.5">
                      <Bell className="w-4 h-4" />
                      교회 소식 / 알림
                    </h3>
                    <button 
                      onClick={() => setActiveTab('news')}
                      className="text-xs text-[#2D5A27] hover:underline"
                    >
                      더보기 +
                    </button>
                  </div>
                  
                  <div className="divide-y divide-gray-100">
                    {notices.slice(0, 4).map((notice) => (
                      <div 
                        key={notice.id} 
                        className="py-3 hover:bg-gray-50/50 rounded-xl px-1 transition-all cursor-pointer flex items-center justify-between"
                        onClick={() => setActiveTab('news')}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                            notice.category === '공지' ? 'bg-[#2D5A27]/10 text-[#2D5A27]' :
                            notice.category === '주보' ? 'bg-[#D69E2E]/10 text-[#744210]' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {notice.category}
                          </span>
                          <p className="text-xs text-gray-800 font-medium line-clamp-1 max-w-[200px] sm:max-w-md">
                            {notice.title}
                          </p>
                        </div>
                        <span className="text-[10px] text-gray-400">{notice.date}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-150 flex items-center justify-between text-xs bg-gray-50 p-3 rounded-2xl">
                  <span className="text-gray-500 font-medium">이번 주 주보를 온라인에서 직접 열람하세요</span>
                  <button 
                    onClick={() => setActiveTab('news')}
                    className="text-white bg-[#2D5A27] px-3 py-1 rounded-lg text-[10px] font-bold shadow-sm"
                  >
                    주보 열기
                  </button>
                </div>
              </div>

              {/* BENTO BLOCK 7: GOOGLE MAPS BLOCK (Semarang Korean Church Map Guide) */}
              <div 
                id="bento-map"
                className="md:col-span-6 bg-white border border-[#E2E8F0] p-5 sm:p-6 rounded-3xl shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#D69E2E]" />
                      <h4 className="text-sm font-bold text-gray-800">오시는 길 & 약도안내</h4>
                    </div>
                    <span className="text-[10px] text-gray-400 font-sans">Semarang</span>
                  </div>

                  <p className="text-xs text-gray-500 mb-3">
                    주소: Jl.Diponegoro no 233, S.T.T abodiel,ungran 50521 indonesia<br/>
                    (STT 아브디엘 내 위치, 주차 공간이 완비되어 있습니다)
                  </p>

                  <div className="w-full h-[150px] bg-gray-100 rounded-2xl overflow-hidden relative border border-gray-150">
                    {/* Simulated Map or Custom Layout to prevent frame break */}
                    <div className="absolute inset-0 bg-[#E8ECEF] flex flex-col items-center justify-center p-4 text-center">
                      <MapPin className="w-8 h-8 text-[#2D5A27] animate-bounce" />
                      <span className="text-xs font-bold text-gray-700 mt-2">Semarang Korean Church</span>
                      <span className="text-[10px] text-gray-500 mt-0.5">스마랑 한인교회 성전</span>
                      <a 
                        href="https://maps.app.goo.gl/4Zi6empA5DfKQUqY9" 
                        target="_blank" 
                        rel="noreferrer"
                        className="mt-2 bg-[#2D5A27] text-white text-[10px] font-bold py-1 px-3 rounded-lg flex items-center gap-1 shadow"
                      >
                        구글맵에서 크게보기 <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-between items-center pt-2">
                  <span className="text-[11px] text-yellow-600 bg-yellow-50 px-2.5 py-1 rounded-lg font-medium">인도네시아 주정부 등록 완료 교회</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText('Jl.Diponegoro no 233, S.T.T abodiel,ungran 50521 indonesia');
                      alert('교회 주소가 복사되었습니다.');
                    }}
                    className="text-xs text-[#2D5A27] hover:underline font-bold"
                  >
                    주소 텍스트 복사
                  </button>
                </div>
              </div>

              {/* BENTO BLOCK 8: EVENT SCHEDULE OVERVIEW (Calendar sync preview) */}
              <div 
                id="bento-calendar"
                className="md:col-span-6 bg-white border border-[#E2E8F0] p-5 sm:p-6 rounded-3xl shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center mb-3 border-b pb-2">
                    <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-[#2D5A27]" />
                      이번 주 / 다음 달 주요 행사
                    </h4>
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">캘린더 연동</span>
                  </div>

                  <div className="space-y-3">
                    {events.slice(0, 3).map(evt => (
                      <div key={evt.id} className="flex gap-3 text-xs leading-relaxed items-start">
                        <div className="text-center font-mono shrink-0">
                          <p className="bg-emerald-50 text-[#2D5A27] font-bold px-2 py-1 rounded">
                            {evt.date.substring(5, 10)}
                          </p>
                        </div>
                        <div>
                          <h5 className="font-bold text-gray-800 line-clamp-1">{evt.title}</h5>
                          <p className="text-[10px] text-gray-500 line-clamp-1">{evt.location} | {evt.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => setActiveTab('news')}
                  className="mt-4 w-full py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 text-[11px] font-bold rounded-xl transition-all"
                >
                  기념 교회 연력 및 월간 캘린더 전체보기
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ===================================== */}
        {/* TAB 2: CHURCH INTRODUCTION (교회 소개) */}
        {/* ===================================== */}
        {activeTab === 'about' && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <h2 className="text-3xl font-serif font-bold text-[#2D5A27] border-b pb-3 mb-6">스마랑 한인교회 소개</h2>
            
            {/* Greetings Section */}
            <div className="bg-white border rounded-3xl p-6 sm:p-8 shadow-sm mb-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="bg-[#2D5A27]/5 p-5 rounded-2xl text-center border border-gray-100">
                  <div className="w-24 h-24 bg-[#E2E8F0] rounded-full mx-auto overflow-hidden border-4 border-white shadow">
                    <img 
                      src={pastorImage} 
                      alt="이인영 담임목사"
                      className="w-full h-full object-cover object-top"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <h4 className="text-base font-bold text-gray-800 mt-3">{headPastor} 담임목사</h4>
                  <p className="text-[11px] text-gray-500 mt-1">Semarang Korean Church Senior Pastor</p>
                </div>
                
                <div className="md:col-span-2">
                  <h3 className="text-lg font-bold font-serif text-[#2D5A27] mb-3">"여기에 오신 모든 분을 주님의 이름으로 축복하고 환영합니다."</h3>
                </div>
              </div>
            </div>

            {/* Serving members (섬기는 분들) */}
            <div className="bg-white border rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#2D5A27]" />
                교회를 섬기는 분들
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col justify-between">
                  <p className="font-bold text-gray-800 text-sm">{headPastor}</p>
                  <span className="text-[10px] text-gray-500 font-medium mt-1">담임목사</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col justify-between">
                  <p className="font-bold text-gray-800 text-sm sm:whitespace-nowrap">{evangelists}</p>
                  <span className="text-[10px] text-gray-500 font-medium mt-1">교육 전도사</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col justify-between">
                  <p className="font-bold text-gray-800 text-xs sm:text-sm tracking-tight">{elders}</p>
                  <span className="text-[10px] text-gray-500 font-medium mt-1">시무 장로</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col justify-between">
                  <p className="font-bold text-gray-800 text-sm">{missionElders}</p>
                  <span className="text-[10px] text-gray-500 font-medium mt-1">선교 장로</span>
                </div>
              </div>
            </div>

            {/* 예배 및 모임 안내 (Full schedule from photo) */}
            <div className="bg-white border rounded-3xl p-6 sm:p-8 shadow-sm mt-8">
              <div className="flex items-center gap-2 mb-6 border-b pb-4">
                <Clock className="w-5 h-5 text-[#2D5A27]" />
                <div>
                  <h3 className="text-lg font-bold text-gray-800">예배 및 모임 안내</h3>
                  <p className="text-xs text-gray-400 mt-0.5">공식 주보에 게재된 스마랑 한인교회의 모든 정기 모임 시간표입니다.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left side: Regular Worship & Prayer */}
                <div className="lg:col-span-2">
                  <h4 className="font-bold text-[#2D5A27] text-sm flex items-center gap-1.5 mb-3">
                    <span className="w-1 h-3.5 bg-[#2D5A27] rounded-full inline-block"></span>
                    예배 및 기도 모임
                  </h4>
                  <div className="overflow-hidden border border-gray-100 rounded-2xl shadow-inner bg-gray-50/50">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100/80 text-gray-700 text-xs font-bold border-b border-gray-200">
                          <th className="py-2.5 px-4">예배 및 기도모임</th>
                          <th className="py-2.5 px-4">시간</th>
                          <th className="py-2.5 px-4 text-right">장소</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-xs text-gray-600">
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">주일 1부 예배</td>
                          <td className="py-3 px-4 font-semibold text-[#2D5A27]">주일 오전 8:30</td>
                          <td className="py-3 px-4 text-right"><span className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-medium px-2 py-0.5 rounded text-[10px]">소예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">주일 2부 예배</td>
                          <td className="py-3 px-4 font-semibold text-[#2D5A27]">주일 오전 10:00</td>
                          <td className="py-3 px-4 text-right"><span className="bg-[#2D5A27]/10 text-[#2D5A27] border border-[#2D5A27]/15 font-bold px-2 py-0.5 rounded text-[10px]">대예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">새벽 기도</td>
                          <td className="py-3 px-4 text-[#7e7975] border-[#76716e] font-medium">월~금 오전 5:00</td>
                          <td className="py-3 px-4 text-right"><span className="bg-amber-50 text-amber-800 border border-amber-100 font-medium px-2 py-0.5 rounded text-[10px]">대예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">수요 예배</td>
                          <td className="py-3 px-4 text-gray-700">수요일 오전 10:30</td>
                          <td className="py-3 px-4 text-right"><span className="bg-amber-50 text-amber-800 border border-amber-100 font-medium px-2 py-0.5 rounded text-[10px]">대예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">금요 찬양기도회</td>
                          <td className="py-3 px-4 text-gray-700">금요일 오후 7:30</td>
                          <td className="py-3 px-4 text-right"><span className="bg-amber-50 text-amber-800 border border-amber-100 font-medium px-2 py-0.5 rounded text-[10px]">대예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">주일 기도회</td>
                          <td className="py-3 px-4 text-gray-600">주일 오전 8:50</td>
                          <td className="py-3 px-4 text-right"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px]">중고등부실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">권사 기도회</td>
                          <td className="py-3 px-4 text-gray-600">수요일 오전 9:50</td>
                          <td className="py-3 px-4 text-right"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px]">중고등부실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">토요 중보기도회</td>
                          <td className="py-3 px-4 text-gray-600">토요일 오전 10:30</td>
                          <td className="py-3 px-4 text-right"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px]">중고등부실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">새가족반</td>
                          <td className="py-3 px-4 text-gray-600">주일 낮 12:00</td>
                          <td className="py-3 px-4 text-right"><span className="bg-emerald-50 text-emerald-800 border border-emerald-100 font-medium px-2 py-0.5 rounded text-[10px]">소예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">순장 모임</td>
                          <td className="py-3 px-4 text-gray-600">주일 오후 1:00</td>
                          <td className="py-3 px-4 text-right"><span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px]">중고등부실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/50">
                          <td className="py-3 px-4 font-bold text-gray-800">생명 싸개</td>
                          <td className="py-3 px-4 text-gray-600">목 오후 2:00</td>
                          <td className="py-3 px-4 text-right"><span className="bg-indigo-50 text-indigo-800 border border-indigo-100 px-2 py-0.5 rounded text-[9.5px] font-bold">봉사의 집 즐리름교회</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right side: Church School */}
                <div>
                  <h4 className="font-bold text-[#D69E2E] text-sm flex items-center gap-1.5 mb-3">
                    <span className="w-1 h-3.5 bg-[#D69E2E] rounded-full inline-block"></span>
                    교회학교 예배
                  </h4>
                  <div className="overflow-hidden border border-amber-100 rounded-2xl shadow-inner bg-[#FFFDF5]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-amber-50 text-amber-900 text-xs font-bold border-b border-amber-100">
                          <th className="py-2.5 px-4">교회학교 예배</th>
                          <th className="py-2.5 px-4">시간</th>
                          <th className="py-2.5 px-4 text-right">장소</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100/50 text-xs text-amber-900/80">
                        <tr className="hover:bg-white transition-colors">
                          <td className="py-3.5 px-4 font-bold">영아부</td>
                          <td className="py-3.5 px-4 text-amber-800 font-medium">주일 오전 9:30</td>
                          <td className="py-3.5 px-4 text-right"><span className="bg-yellow-50 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold border border-yellow-200">유아실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/30">
                          <td className="py-3.5 px-4 font-bold">유초등부</td>
                          <td className="py-3.5 px-4 text-amber-800 font-medium">주일 오전 10:00</td>
                          <td className="py-3.5 px-4 text-right"><span className="bg-yellow-50 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold border border-yellow-200">유초등부실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors">
                          <td className="py-3 px-4 font-bold" rowSpan={2}>중고등부</td>
                          <td className="py-2 px-4 text-amber-800 font-medium border-b border-amber-100/30">주일 오전 10:00</td>
                          <td className="py-2 px-4 text-right border-b border-amber-100/30"><span className="bg-yellow-50 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold border border-yellow-200">대예배실</span></td>
                        </tr>
                        <tr className="hover:bg-white transition-colors bg-white/30">
                          <td className="py-2 px-4 text-amber-800 font-medium">주일 낮 12:00</td>
                          <td className="py-2 px-4 text-right"><span className="bg-yellow-50 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold border border-yellow-200">중고등부실</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 bg-[#2D5A27]/5 border border-[#2D5A27]/10 p-4 rounded-2xl">
                    <h5 className="font-bold text-[#2D5A27] text-xs mb-1 flex items-center gap-1">📍 믿음 안의 다음세대 교육</h5>
                    <p className="text-[11px] text-gray-600 leading-relaxed">
                      스마랑 한인교회의 유치부, 유초등부, 중고등부는 각 부서 전문 전담 성경 교사들의 지도하에 아이들의 인성과 하나님을 만나는 믿음의 터전을 가꿉니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ===================================== */}
        {/* TAB 3: WORSHIP & MESSAGE (예배와 말씀) */}
        {/* ===================================== */}
        {activeTab === 'word' && (
          <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b pb-3 mb-6 gap-4">
              <h2 className="text-3xl font-serif font-bold text-[#2D5A27] flex items-center gap-2">
                <Video className="w-7 h-7 text-[#2D5A27]" />
                예배와 말씀 자료실
              </h2>
              <a 
                href="https://www.youtube.com/@%EC%8A%A4%EB%A7%88%EB%9E%91%ED%95%9C%EC%9D%B8%EA%B5%90%ED%9A%8C"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition-all flex items-center justify-center gap-2 w-fit"
              >
                <Video className="w-4 h-4 fill-white" />
                공식 유튜브 채널 바로가기
              </a>
            </div>

            {/* Display active selection */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              
              {/* YouTube Main Video Frame */}
              <div className="lg:col-span-2 bg-black rounded-3xl overflow-hidden aspect-video relative shadow-lg">
                <iframe 
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube.com/embed/${activeVideoId}`}
                  title="Main Sermon Player"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* Sidebar: Bible Scripture Reflection & PDF download option */}
              <div className="bg-white border p-6 rounded-3xl shadow-sm flex flex-col justify-between min-h-[340px]">
                {isEditingInline ? (
                  <form onSubmit={handleSaveInlineEdit} className="space-y-3.5 text-xs w-full">
                    <div className="flex items-center justify-between border-b pb-2 mb-2">
                      <span className="font-bold text-gray-800 text-sm">✏️ 주간 말씀 내용 수정</span>
                      <button 
                        type="button" 
                        onClick={() => setIsEditingInline(false)}
                        className="text-gray-400 hover:text-gray-600 font-bold"
                      >
                        취소
                      </button>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-bold mb-1">설교 제목</label>
                      <input 
                        type="text" 
                        required
                        className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                        value={inlineSermonForm.title}
                        onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, title: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">설교자</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          value={inlineSermonForm.preacher}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, preacher: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">본문 말씀</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          placeholder="예: 에베소서 5:15"
                          value={inlineSermonForm.scripture}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, scripture: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">예배 일자</label>
                        <input 
                          type="date" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          value={inlineSermonForm.date}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, date: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">YouTube ID</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none font-mono"
                          value={inlineSermonForm.youtubeId}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, youtubeId: e.target.value })}
                        />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-[#2D5A27] text-white py-2.5 rounded-xl font-bold text-xs hover:bg-[#1a3818] transition-all shrink-0 mt-2"
                    >
                      변경 사항 저장하기
                    </button>
                  </form>
                ) : isAddingInline ? (
                  <form onSubmit={handleSaveInlineAdd} className="space-y-3.5 text-xs w-full">
                    <div className="flex items-center justify-between border-b pb-2 mb-2">
                      <span className="font-bold text-[#2D5A27] text-sm">➕ 새 주간 말씀 등록</span>
                      <button 
                        type="button" 
                        onClick={() => setIsAddingInline(false)}
                        className="text-gray-400 hover:text-gray-600 font-bold"
                      >
                        취소
                      </button>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-bold mb-1">설교 제목</label>
                      <input 
                        type="text" 
                        required
                        placeholder="예: 주 보좌 앞에 모여"
                        className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                        value={inlineSermonForm.title}
                        onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, title: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">설교자</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          value={inlineSermonForm.preacher}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, preacher: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">본문 말씀</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          placeholder="예: 창세기 1:1"
                          value={inlineSermonForm.scripture}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, scripture: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">예배 일자</label>
                        <input 
                          type="date" 
                          required
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none"
                          value={inlineSermonForm.date}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, date: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">YouTube ID</label>
                        <input 
                          type="text" 
                          required
                          placeholder="예: 8KK022vRSh8"
                          className="w-full border p-2 rounded-xl bg-gray-50 text-xs focus:ring-1 focus:ring-[#2D5A27] focus:outline-none font-mono"
                          value={inlineSermonForm.youtubeId}
                          onChange={(e) => setInlineSermonForm({ ...inlineSermonForm, youtubeId: e.target.value })}
                        />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-[#2D5A27] text-white py-2.5 rounded-xl font-bold text-xs hover:bg-[#1a3818] transition-all shrink-0 mt-2"
                    >
                      새로운 설교 실시간 업로드
                    </button>
                  </form>
                ) : (
                  <div className="flex flex-col justify-between h-full w-full">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs bg-red-50 text-red-600 px-2.5 py-1 rounded-lg font-bold">
                          {sermons.find(s => s.youtubeId === activeVideoId)?.date || '최신 등록 말씀'}
                        </span>
                        
                        {isAdminAuthenticated && (
                          <span className="text-[10px] bg-emerald-50 text-[#2D5A27] border border-emerald-200 px-1.5 py-0.5 rounded-md font-bold">
                            관리자 서명인증 완료
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-gray-800 mt-2 mb-1">
                        {sermons.find(s => s.youtubeId === activeVideoId)?.title || '매일매일 성령 충만한 건강한 삶'}
                      </h3>
                      <p className="text-xs text-gray-500">설교자: {sermons.find(s => s.youtubeId === activeVideoId)?.preacher || '이인영 담임목사'}</p>
                      
                      <div className="mt-4 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 leading-relaxed border border-dashed">
                        <span className="font-bold text-[#2D5A27] block mb-1">성경 본문 말씀:</span>
                        {sermons.find(s => s.youtubeId === activeVideoId)?.scripture || '에베소서 5:15-21'}
                      </div>
                    </div>

                    {/* Admin Access & controls area at bottom of sidebar */}
                    {isAdminAuthenticated && (
                      <div className="mt-6 pt-4 border-t border-gray-100">
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const cs = sermons.find(s => s.youtubeId === activeVideoId);
                                if (cs) handleStartInlineEdit(cs);
                              }}
                              className="flex-1 flex items-center justify-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-xl text-[11px] font-bold transition-all"
                            >
                              ✏️ 정보 수정
                            </button>
                            <button
                              onClick={handleStartInlineAdd}
                              className="flex-1 flex items-center justify-center gap-1 bg-[#2D5A27] hover:bg-opacity-90 text-white py-2 rounded-xl text-[11px] font-bold transition-all"
                            >
                              ➕ 새 설교 등록
                            </button>
                          </div>
                          <button
                            onClick={() => setIsAdminAuthenticated(false)}
                            className="w-full text-center text-[10px] text-gray-400 hover:text-red-500 font-semibold transition-all py-1"
                          >
                            관리자 권한 로그아웃
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {sermons.map((sermon) => (
                <div 
                  key={sermon.id} 
                  className={`border rounded-2xl overflow-hidden cursor-pointer bg-white hover:shadow-md transition-all relative ${
                    sermon.youtubeId === activeVideoId ? 'ring-2 ring-[#2D5A27] bg-[#2D5A27]/5' : ''
                  }`}
                  onClick={() => setActiveVideoId(sermon.youtubeId)}
                >
                  <div className="p-5 flex flex-col justify-between h-full min-h-[140px]">
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-gray-400 font-bold block">{sermon.date}</span>
                        {isAdminAuthenticated && (
                          <button
                            onClick={(e) => handleDeleteInlineSermon(sermon.id, e)}
                            className="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 transition-all cursor-pointer z-10"
                            title="설교 말씀 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <h4 className="font-bold text-sm text-gray-800 mt-1 hover:text-[#2D5A27] line-clamp-2">{sermon.title}</h4>
                    </div>
                    <div className="mt-4">
                      <p className="text-xs text-emerald-800 font-semibold">{sermon.scripture}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{sermon.preacher}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ===================================== */}
        {/* TAB: CELL GROUPS (순공동체)           */}
        {/* ===================================== */}
        {activeTab === 'cell' && (
          <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
            <div className="bg-gradient-to-br from-[#1a3818] to-[#2D5A27] rounded-3xl p-6 sm:p-8 text-white mb-8 shadow-md">
              <span className="text-[#F6AD55] bg-white/10 text-[10px] sm:text-xs font-bold tracking-widest px-2.5 py-1 rounded-full uppercase">
                스마랑한인교회 소그룹
              </span>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white mt-3 mb-2">사랑과 말씀의 순공동체</h2>
              <p className="text-xs text-emerald-100 leading-relaxed max-w-2xl">
                "두세 사람이 내 이름으로 모인 곳에는 나도 그들 중에 있느니라" (마태복음 18:20)<br />
                스마랑 한인교회 순모임은 삶과 신앙을 함께 나누며, 서로를 위해 기도하고 하나님의 사랑을 나누는 거룩한 세포 소그룹 공동체입니다.
              </p>
            </div>

            {/* Core Values Section */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                { title: '말씀과 나눔', desc: '삶 속에 역사하신 주님의 말씀을 깊이 묵상하고 은혜를 정직하게 고백합니다.' },
                { title: '기도와 치유', desc: '성도들의 삶의 아픔과 기쁨을 한마음으로 보듬고 끝까지 중보하며 기도합니다.' },
                { title: '사랑의 교제', desc: '낯선 타향인 인도네시아 땅에서 주님의 사랑으로 맺어진 든든한 가족이 됩니다.' }
              ].map((v, i) => (
                <div key={i} className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4">
                  <h4 className="font-bold text-gray-800 text-xs mb-1 text-[#2D5A27]">{v.title}</h4>
                  <p className="text-[11px] text-gray-600 leading-normal">{v.desc}</p>
                </div>
              ))}
            </div>

            {/* Cell List: Vertical Alignment */}
            <div className="space-y-4">
              <div className="border-b pb-2 mb-3">
                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#2D5A27]" />
                  <span>스마랑한인교회 소속 순공동체 현황 ({[
                    '스마랑A', '스마랑 B', '웅아란', '살라티카 A', '살라티카B', '살라티카 C', 
                    '여호수아 A', '여호수아B', '즈빠라', '바탕', '인니가족'
                  ].length}개 순)</span>
                </h3>
              </div>

              {[
                '스마랑A', '스마랑 B', '웅아란', '살라티카 A', '살라티카B', '살라티카 C', 
                '여호수아 A', '여호수아B', '즈빠라', '바탕', '인니가족'
              ].map((name, idx) => (
                <div 
                  key={idx} 
                  className="bg-white border hover:border-[#2D5A27] transition-colors rounded-2xl p-4 shadow-sm flex items-center gap-4 animate-fade-in"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#2D5A27] font-bold text-xs flex items-center justify-center shrink-0 border border-emerald-100 font-serif">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-800 text-sm">{name} 순</h4>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================================== */}
        {/* TAB 4: NEXT GENERATION (다음 세대) */}
        {/* ===================================== */}
        {activeTab === 'next' && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <h2 className="text-3xl font-serif font-bold text-[#2D5A27] border-b pb-3 mb-6">스마랑 다음세대 사역</h2>
            <p className="text-xs text-gray-500 mb-6 font-medium">스마랑 한인교회의 미래인 다음 세대를 향한 체계적인 영적 발돋움과 섬김의 교육 부서입니다.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { 
                  name: '영아부', 
                  target: '영유아 및 부모님', 
                  time: '주일 오전 9:30', 
                  place: '유아실',
                  desc: '부모와 소중한 자녀가 함께 따뜻한 환경에서 드리는 영유아 맞춤형 오감 예배 및 축복 기도의 시간입니다.' 
                },
                { 
                  name: '유초등부', 
                  target: '미취학 아동 ~ 초등학교 6학년', 
                  time: '주일 오전 10:00', 
                  place: '유초등부실',
                  desc: '어린이 눈높이에 맞는 성경 탐구, 다채로운 창의 놀이 찬양과 공과 적용 중심의 신앙 습관을 기릅니다.' 
                },
                { 
                  name: '중고등부 (청소년부)', 
                  target: '중학교 1학년 ~ 고등학교 3학년', 
                  time: '주일 오전 10:00 (연합대예배) & 낮 12:00 (부서예배)', 
                  place: '대예배실 & 중고등부실',
                  desc: '오전 10시에는 대예배실에서 연합 예배로 동참하고, 낮 12시에는 전용 교실에서 청소년 맞춤형 성령 충만 소그룹 큐티와 우애 나눔을 가꿉니다.' 
                }
              ].map((dept, idx) => (
                <div key={idx} className="bg-white border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#D69E2E] bg-yellow-50 px-2 py-1 rounded">DEPT EDUCATION</span>
                    <h3 className="text-lg font-bold text-gray-800 mt-2 mb-1">{dept.name}</h3>
                    <p className="text-xs text-gray-600 leading-relaxed mb-4">{dept.desc}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-2xl text-[11px] text-gray-500 space-y-1">
                    <p>🎯 대상: <strong className="text-gray-700">{dept.target}</strong></p>
                    <p>🕐 시간: <strong className="text-gray-700">{dept.time}</strong></p>
                    <p>📍 장소: <strong className="text-gray-700">{dept.place}</strong></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================================== */}
        {/* TAB 5: MISSION & SERVICE (선교와 사역) */}
        {/* ===================================== */}
        {activeTab === 'mission' && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            {/* Header section reflecting the exact title of the user's paper */}
            <div className="text-center mb-8 bg-gradient-to-b from-[#2D5A27]/10 to-[#2D5A27]/5 p-8 rounded-3xl border border-[#2D5A27]/20 relative overflow-hidden">
              <div className="absolute right-0 top-0 opacity-10 transform translate-x-6 -translate-y-6">
                <Globe className="w-48 h-48 text-[#2D5A27]" />
              </div>
              <span className="text-[11px] font-bold text-[#2D5A27] uppercase tracking-widest bg-emerald-100 border border-[#2D5A27]/30 px-3 py-1 rounded-full inline-block mb-3">
                MISSION CENTRAL JAVA 2026
              </span>
              <h2 className="text-2xl sm:text-3xl font-serif font-extrabold text-[#2D5A27] tracking-tight">
                2026년 우리 교회가 섬기는 곳
              </h2>
              <p className="text-sm font-medium text-amber-700 mt-2 flex items-center justify-center gap-1.5">
                <HeartHandshake className="w-4 h-4" />
                중부자바와 선교를 위해 간절히 기도해 주세요
              </p>
              
              {/* Simple Statistics overview for high visual polish */}
              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto mt-6">
                <div className="bg-white/80 backdrop-blur-sm p-3 rounded-2xl border border-emerald-50 shadow-sm">
                  <p className="text-[10px] text-gray-500 font-bold">협력 선교사</p>
                  <p className="text-xl font-serif font-bold text-[#2D5A27] mt-0.5">9명</p>
                </div>
                <div className="bg-white/80 backdrop-blur-sm p-3 rounded-2xl border border-emerald-50 shadow-sm">
                  <p className="text-[10px] text-gray-500 font-bold">현지 목회자</p>
                  <p className="text-xl font-serif font-bold text-[#2D5A27] mt-0.5">4명</p>
                </div>
                <div className="bg-white/80 backdrop-blur-sm p-3 rounded-2xl border border-emerald-50 shadow-sm">
                  <p className="text-[10px] text-gray-500 font-bold">선교 후원</p>
                  <p className="text-xl font-serif font-bold text-[#2D5A27] mt-0.5">11개처</p>
                </div>
              </div>
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap justify-center gap-1.5 mb-8 bg-gray-100/80 p-1 rounded-2xl max-w-xl mx-auto border border-gray-200">
              {[
                { id: 'all', label: '전체보기' },
                { id: 'missionary', label: '협력 선교사' },
                { id: 'pastor', label: '현지 목회자' },
                { id: 'support', label: '선교 후원' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMissionTab(tab.id as any)}
                  className={`text-xs px-4 py-2 rounded-xl font-bold transition-all ${
                    missionTab === tab.id 
                    ? 'bg-[#2D5A27] text-white shadow-md' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Lists */}
            <div className="space-y-8">
              
              {/* Category 1: 협력 선교사 (Cooperating Missionaries) */}
              {(missionTab === 'all' || missionTab === 'missionary') && (
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 border-b pb-3 mb-4">
                    <span className="p-1 px-2.5 text-[10px] font-sans font-bold text-emerald-800 bg-emerald-50 rounded border border-emerald-200 uppercase">
                      Cooperating Missionaries
                    </span>
                    <h3 className="text-base font-bold text-gray-800">협력 선교사 (9명)</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { name: '김동호 선교사' },
                      { name: '김성훈 선교사' },
                      { name: '김영숙 선교사' },
                      { name: '김인호 선교사' },
                      { name: '김진영 선교사' },
                      { name: '김창기 선교사' },
                      { name: '서보희 선교사' },
                      { name: '이미정 선교사' },
                      { name: '홍바하 선교사' }
                    ].map((m, idx) => (
                      <div key={idx} className="p-3 bg-[#FAF9F5] border border-gray-100 rounded-2xl hover:border-[#2D5A27]/30 transition-all shadow-sm">
                        <div className="flex items-center gap-1.5 justify-center sm:justify-start">
                          <div className="w-2 h-2 rounded-full bg-[#2D5A27] shrink-0"></div>
                          <p className="font-bold text-gray-800 text-xs sm:text-sm">{m.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 2: 현지 목회자 (Local Pastors) */}
              {(missionTab === 'all' || missionTab === 'pastor') && (
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 border-b pb-3 mb-4">
                    <span className="p-1 px-[10px] text-[10px] font-sans font-bold text-amber-800 bg-amber-50 rounded border border-amber-200 uppercase">
                      Native Pastors
                    </span>
                    <h3 className="text-base font-bold text-gray-800">현지 목회자 (4명)</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { name: '시아니 압디엘 교수' },
                      { name: '제이슨 목사' },
                      { name: '히스기야 목사' },
                      { name: 'Wahyu 목사' }
                    ].map((p, idx) => (
                      <div key={idx} className="p-3 bg-gradient-to-br from-white to-amber-50/20 border border-amber-100 rounded-2xl text-center flex flex-col items-center justify-center min-h-[60px] shadow-sm hover:shadow transition-all">
                        <p className="font-extrabold text-[#2D5A27] text-xs sm:text-sm flex items-center gap-1.5 justify-center">
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          {p.name}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category 3: 선교 후원 (Mission Supports) */}
              {(missionTab === 'all' || missionTab === 'support') && (
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 border-b pb-3 mb-4">
                    <span className="p-1 px-2.5 text-[10px] font-sans font-bold text-[#2D5A27] bg-[#2D5A27]/5 rounded border border-[#2D5A27]/20 uppercase">
                      Mission Supports
                    </span>
                    <h3 className="text-base font-bold text-gray-800">선교 후원 (11개처)</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      { name: 'GIA 선교부 (현지교회 3교회)', sub: '현지 교회 사역' },
                      { name: '압디엘 신학교 장학생', sub: '신학 교육' },
                      { name: '가나안 누산따라 신학교', sub: '신학교 지원' },
                      { name: '생명싸개 (봉사의 집, 고아원, 양로원, 즐리름 교회)', sub: '종합 구제 및 보육' },
                      { name: '에덴 고아원', sub: '아동 보호 및 교육' },
                      { name: '은혜의 둥지 고아원', sub: '아동 구제' },
                      { name: '살라띠가 장애인 교회', sub: '장애인 돌봄' },
                      { name: '웅아란 장애인 교회', sub: '장애인 돌봄' },
                      { name: '에벤에셀 교회', sub: '현지 자립교회' },
                      { name: '글로벌비전센터', sub: '종합 비전 지원' },
                      { name: 'GIA Bandarharjo', sub: '현지 선교 교회' }
                    ].map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50/50 hover:bg-[#FAF9F5] border border-gray-100 rounded-2xl transition-all gap-2 shadow-sm">
                        <div className="flex items-center gap-2 overflow-hidden flex-1 text-left">
                          <CheckCircle2 className="w-4 h-4 text-[#2D5A27] shrink-0" />
                          <p className="font-extrabold text-gray-800 text-xs sm:text-sm truncate">{s.name}</p>
                        </div>
                        <span className="font-bold text-[9px] bg-[#2D5A27]/10 text-[#2D5A27] px-2.5 py-0.5 rounded-full border border-[#2D5A27]/20 whitespace-nowrap">
                          {s.sub}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Special Note Box */}
              <div className="p-5 bg-[#FFF9E5] border border-[#F6AD55]/30 rounded-3xl text-xs text-yellow-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="p-1 px-2 text-[10px] font-extrabold bg-[#F6AD55] text-white rounded font-sans shrink-0">NOTICE</span>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">선교 구제 특별 작정 헌금 안내</h4>
                    <p className="text-gray-600 font-light mt-0.5">매월 첫째 주일은 중부자바 일원의 영혼들과 선교 후원지를 향한 구제 작정 주일입니다.</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setActiveTab('community'); }}
                  className="bg-[#2D5A27] text-white font-bold text-[11px] px-4 py-2 rounded-xl shadow-md hover:bg-[#20401b] transition-colors whitespace-nowrap"
                >
                  중보기도 요청하기
                </button>
              </div>

            </div>
          </div>
        )}

        {/* ===================================== */}
        {/* TAB 6: CHURCH NEWS (교회 소식 / 주보) */}
        {/* ===================================== */}
        {activeTab === 'news' && (
          <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="mb-6">
              <h2 className="text-3xl font-serif font-bold text-[#2D5A27] pb-2 flex items-center gap-2">
                <Bell className="w-8 h-8 text-[#2D5A27]" />
                교회 소식 및 종이주보 PDF 보관소
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                매주 정성스레 발행되는 실물 종이 주보의 오리지널 PDF 파일 컬렉션과 교회 공지 피드입니다.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* LEFT COLUMN: PDF BULLETINS LIST & QUICK UPLOAD */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Available bulletins list */}
                <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
                  <h3 className="font-bold text-[#2D5A27] text-sm border-b pb-2 mb-3 flex items-center gap-1.5">
                    <FileText className="w-4 h-4" />
                    주간 종이주보 목록 ({bulletins.length})
                  </h3>
                  
                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {bulletins.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6">등록된 주보 PDF가 아직 없습니다.</p>
                    ) : (
                      bulletins.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setSelectedBulletin(b)}
                          className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                            selectedBulletin?.id === b.id
                              ? 'border-[#2D5A27] bg-emerald-50/60 ring-1 ring-[#2D5A27] shadow-sm'
                              : 'border-gray-150 hover:bg-gray-50/50'
                          }`}
                        >
                          <FileText className={`w-5 h-5 shrink-0 mt-0.5 ${selectedBulletin?.id === b.id ? 'text-[#2D5A27]' : 'text-gray-400'}`} />
                          <div className="min-w-0">
                            <p className={`text-xs text-gray-800 leading-tight truncate ${selectedBulletin?.id === b.id ? 'font-bold text-[#2D5A27]' : 'font-medium'}`}>
                              {b.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 text-[9.5px] text-gray-500 font-mono">
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded font-sans text-gray-600 shrink-0">{b.volume}</span>
                              <span>📅 {b.date}</span>
                              {b.fileSize && <span className="text-gray-400">({b.fileSize})</span>}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Inline Quick PDF Upload widget */}
                <div className="bg-[#FAF9F5] border border-dashed border-[#2D5A27]/35 rounded-3xl p-5 shadow-sm">
                  <h3 className="font-bold text-gray-800 text-xs flex items-center gap-1 mb-1">
                    <Upload className="w-4 h-4 text-[#2D5A27]" />
                    신규 종이주보 PDF 올리기 (사무간사)
                  </h3>
                  <p className="text-[10px] text-gray-500 mb-4 leading-relaxed">
                    주일 실물 종이주보를 PDF 스캔 파일로 변환하여 실시간 등재합니다.
                  </p>

                  <form onSubmit={handleUploadBulletin} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-gray-700 font-bold mb-1">주보 명칭 *</label>
                      <input 
                        type="text"
                        required
                        placeholder="예: 2026년 6월 1일 주간 주보"
                        value={newBulletin.title}
                        onChange={(e) => setNewBulletin({ ...newBulletin, title: e.target.value })}
                        className="w-full border p-2 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-[#2D5A27] text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">발행 주간 일자</label>
                        <input 
                          type="date"
                          value={newBulletin.date}
                          onChange={(e) => setNewBulletin({ ...newBulletin, date: e.target.value })}
                          className="w-full border p-2 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-[#2D5A27] text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">발행 호수</label>
                        <input 
                          type="text"
                          placeholder="예: 제36권 19호"
                          value={newBulletin.volume}
                          onChange={(e) => setNewBulletin({ ...newBulletin, volume: e.target.value })}
                          className="w-full border p-2 rounded-xl bg-white focus:outline-none focus:ring-1 focus:ring-[#2D5A27] text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-semibold mb-1 text-[11px]">실물 PDF 또는 주보 이미지 파일 선택 *</label>
                      <div className="flex items-center gap-2 bg-white border p-2 rounded-xl">
                        <input 
                          type="file"
                          accept="application/pdf, image/*"
                          required
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setBulletinFile(e.target.files[0]);
                            }
                          }}
                          className="w-full text-[10px] text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:bg-[#2D5A27]/10 file:text-[#2D5A27] cursor-pointer"
                        />
                      </div>
                      <p className="text-[9.5px] text-gray-400 mt-1.5 leading-normal">
                        ※ 권장사항: PDF 파일 업로드시 용량이 1MB 이하여야 저장이 정상 처리됩니다. 1MB를 초과하는 대용량 주보는 주보 이미지 파일(PNG/JPG)로 직접 업로드 시 최적화 압축되어 자동 변환·등록됩니다!
                      </p>
                    </div>

                    <button 
                      type="submit"
                      className="w-full py-2 bg-[#2D5A27] hover:bg-emerald-950 text-white font-extrabold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1"
                    >
                      <Upload className="w-3 h-3" />
                      스마트 보관소 파일 업로드
                    </button>
                  </form>
                </div>

              </div>

              {/* RIGHT COLUMN: MULTI-MODE PDF AND TEXT VIEWER */}
              <div className="lg:col-span-8">
                {selectedBulletin ? (
                  <div className="bg-white border rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                    
                    {/* Viewer Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md font-sans text-[10px] font-extrabold bg-[#2D5A27]/10 text-[#2D5A27]">
                            {selectedBulletin.volume}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">발행 기준일: {selectedBulletin.date}</span>
                        </div>
                        <h3 className="text-lg font-bold text-gray-800 mt-1">{selectedBulletin.title}</h3>
                      </div>

                      {/* External download / view tools */}
                      <div className="flex items-center gap-2 font-semibold">
                        <a 
                          href={selectedBulletin.pdfUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-xl flex items-center gap-1.5 transition-colors border"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                          <span>PDF 새창 열람</span>
                        </a>
                        <a 
                          href={selectedBulletin.pdfUrl}
                          download={selectedBulletin.fileName || 'skc_bulletin.pdf'}
                          className="p-2 bg-[#2D5A27] hover:bg-emerald-900 text-white text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>주보 다운로드</span>
                        </a>
                      </div>
                    </div>

                    {/* Viewer Frame Container */}
                    <div className="bg-[#FCFAF6] border border-gray-200 rounded-2xl p-4 min-h-[480px] flex flex-col justify-between">
                      <div className="space-y-4 flex flex-col flex-grow">
                        {selectedBulletin.pdfUrl.startsWith('data:image/') ? (
                          <div className="w-full h-[520px] rounded-xl border bg-white shadow-inner flex-grow overflow-auto p-2 flex justify-center items-start">
                            <img 
                              src={selectedBulletin.pdfUrl}
                              alt={selectedBulletin.title}
                              className="max-w-full h-auto object-contain rounded-lg shadow-sm"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <iframe 
                            src={selectedBulletin.pdfUrl}
                            className="w-full h-[520px] rounded-xl border bg-white shadow-inner flex-grow"
                            title="Interactive Bulletin PDF Reader"
                          />
                        )}
                        <p className="text-[10px] text-gray-400 text-center leading-relaxed">
                          💡 브라우저 인라인 PDF 방침 혹은 iFrame 정책에 따라 화면이 보이지 않을 경우, 상단의 <strong className="text-gray-600">[PDF 새창 열람]</strong> 또는 <strong className="text-gray-600">[다운로드]</strong>를 통해 편하게 실물 주보를 수령하실 수 있습니다!
                        </p>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-12 text-center min-h-[300px] flex flex-col justify-center items-center">
                    <FileText className="w-12 h-12 text-gray-300 mb-3" />
                    <h3 className="font-bold text-gray-700">선택된 주보가 없습니다</h3>
                    <p className="text-xs text-gray-400 mt-1">왼쪽 목록에서 보고 싶은 주간 종이 주보를 선정해 주세요.</p>
                  </div>
                )}
              </div>

            </div>

            {/* Church General Notices / Feed (Keeping in a very beautiful minimal look at the bottom) */}
            <div className="mt-12">
              <h3 className="text-2xl font-serif font-bold text-gray-800 mb-2">교인 행정공지 및 소식록</h3>
              <p className="text-xs text-gray-400 mb-6">스마랑 한인회 사목과 제직회 제반 전달사항 및 일람 안내입니다.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {notices.map((nt) => (
                  <div key={nt.id} className="bg-white border p-5 rounded-3xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded ${
                          nt.category === '공지' ? 'bg-[#2D5A27]/10 text-[#2D5A27]' :
                          nt.category === '주보' ? 'bg-[#D69E2E]/10 text-[#744210]' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {nt.category}
                        </span>
                        <span className="text-[10px] font-mono text-gray-400 shrink-0">{nt.date}</span>
                      </div>
                      <h4 className="font-bold text-gray-800 text-sm leading-tight mb-2">{nt.title}</h4>
                      <p className="text-xs text-gray-600 leading-relaxed font-light whitespace-pre-line">{nt.content}</p>
                    </div>
                    <div className="flex justify-between items-center text-[9px] text-gray-400 border-t border-gray-100 mt-4 pt-3">
                      <span>부서: {nt.author}</span>
                      <span className="bg-emerald-50 px-1.5 py-0.5 rounded text-[8.5px] scale-95 origin-right">스마랑 한인교회 공식</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ===================================== */}
        {/* TAB 8: COMMUNITY & CORRESPONDENCE (교제와 나눔 / 중보기도) */}
        {/* ===================================== */}
        {activeTab === 'community' && (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <h2 className="text-3xl font-serif font-bold text-[#2D5A27] border-b pb-3 mb-6">교제와 은혜의 나눔</h2>
            
            {/* Inline Admin Controller for Photos & Gallery */}
            {isAdminAuthenticated ? (
              <div className="bg-emerald-50/50 border border-emerald-250/65 p-6 rounded-3xl mb-8 text-xs">
                {editingGalleryItem ? (
                  <form onSubmit={handleSaveGalleryItemEdit} className="space-y-3">
                    <div className="flex items-center justify-between border-b border-emerald-200 pb-2 mb-2">
                      <span className="font-bold text-[#2D5A27] text-sm">✏️ 교회 추억 사진록 정정 (수정)</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          setEditingGalleryItem(null);
                          setGalleryFile(null);
                        }}
                        className="text-gray-400 hover:text-gray-600 font-bold"
                      >
                        정정 취소
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">사진 제목 *</label>
                        <input 
                          type="text" 
                          required
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs"
                          value={editingGalleryItem.title}
                          onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, title: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">행사 날짜 *</label>
                        <input 
                          type="date" 
                          required
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs font-mono"
                          value={editingGalleryItem.date}
                          onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, date: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-bold mb-1">상세 기록 / 메모 설명 *</label>
                      <textarea 
                        required
                        className="w-full border p-2.5 rounded-xl bg-white h-20 focus:outline-none text-xs"
                        value={editingGalleryItem.description}
                        onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, description: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">웹 이미지 주소 (선택)</label>
                        <input 
                          type="text"
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs font-mono"
                          placeholder="https://example.com/photo.jpg"
                          value={editingGalleryItem.imageUrl || ''}
                          onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, imageUrl: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">새 실물 사진 파일로 교체</label>
                        <input 
                          type="file"
                          accept="image/*"
                          className="w-full text-xs"
                          onChange={handleGalleryFileChange}
                        />
                      </div>
                    </div>

                    {galleryPreview && (
                      <div className="p-2 border border-emerald-100 rounded-xl bg-emerald-50/30 flex items-center gap-3 animate-pulse">
                        <img src={galleryPreview} className="w-16 h-16 object-cover rounded-lg border-2 border-white shadow" />
                        <div className="text-[10px] text-emerald-800 flex-grow">
                          <p className="font-extrabold">업로드 예정 사진 미리보기</p>
                          <p className="text-gray-450 mt-0.5">저장 버튼 클릭 시 실시간으로 적용됩니다.</p>
                        </div>
                        <button 
                          type="button"
                          onClick={() => { setGalleryFile(null); setGalleryPreview(null); }}
                          className="text-[10px] text-red-600 font-bold px-2.5 py-1 bg-red-50 hover:bg-red-150 rounded-lg shadow-sm"
                        >
                          미리보기 취소
                        </button>
                      </div>
                    )}

                    <button 
                      type="submit"
                      className="w-full bg-[#2D5A27] text-white py-2.5 rounded-xl font-bold hover:bg-[#1a3818] transition-all cursor-pointer text-xs"
                    >
                      교회 추억 정정 저장하기
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleAddGalleryItem} className="space-y-3">
                    <h3 className="font-bold text-[#2D5A27] text-sm border-b border-emerald-200 pb-2 mb-2">📸 새 교회 추억 사진 등록 및 내용 업로드</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">사진 제목 *</label>
                        <input 
                          type="text" 
                          required
                          placeholder="예: 추수감사절 연합 페스티벌"
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs"
                          value={newGalleryItem.title}
                          onChange={(e) => setNewGalleryItem({ ...newGalleryItem, title: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">행사 날짜</label>
                        <input 
                          type="date" 
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs font-mono"
                          value={newGalleryItem.date}
                          onChange={(e) => setNewGalleryItem({ ...newGalleryItem, date: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-700 font-bold mb-1">사진 상세 설명 *</label>
                      <textarea 
                        required
                        placeholder="예: 성도님들이 사랑과 땀방울로 전례를 조율하며 일군 소중하고 다정한 예배 현장입니다."
                        className="w-full border p-2.5 rounded-xl bg-white h-20 focus:outline-none text-xs"
                        value={newGalleryItem.description}
                        onChange={(e) => setNewGalleryItem({ ...newGalleryItem, description: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">웹 인터넷 이미지 주소 (선택)</label>
                        <input 
                          type="text" 
                          placeholder="https://images.unsplash.com/photo-..."
                          className="w-full border p-2.5 rounded-xl bg-white focus:outline-none text-xs font-mono"
                          value={newGalleryItem.imageUrl}
                          onChange={(e) => setNewGalleryItem({ ...newGalleryItem, imageUrl: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">실물 사진 직접 파일 업로드 (추천)</label>
                        <input 
                          type="file" 
                          accept="image/*"
                          className="w-full text-xs"
                          onChange={handleGalleryFileChange}
                        />
                      </div>
                    </div>

                    {galleryPreview && (
                      <div className="p-2 border border-emerald-100 rounded-xl bg-emerald-50/30 flex items-center gap-3 animate-pulse">
                        <img src={galleryPreview} className="w-16 h-16 object-cover rounded-lg border-2 border-white shadow" />
                        <div className="text-[10px] text-emerald-800 flex-grow">
                          <p className="font-extrabold font-serif text-[#2D5A27]">신규 업로드 예정 사진 미리보기</p>
                          <p className="text-gray-450 mt-0.5">업로드 및 반영 버튼 클릭 시 홈페이지에 즉시 게시물이 발행됩니다.</p>
                        </div>
                        <button 
                          type="button"
                          onClick={() => { setGalleryFile(null); setGalleryPreview(null); }}
                          className="text-[10px] text-red-650 font-bold px-2.5 py-1 bg-red-50 hover:bg-red-155 rounded-lg shadow-sm"
                        >
                          선택 취소
                        </button>
                      </div>
                    )}

                    <button 
                      type="submit"
                      className="w-full bg-[#2D5A27] text-white py-2.5 rounded-xl font-bold hover:bg-[#1a3818] transition-all cursor-pointer text-xs"
                    >
                      새로운 사진 업로드 및 반영
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <div className="bg-[#FAF9F5] border border-gray-250/65 rounded-3xl p-5 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gray-100 rounded-2xl text-gray-500 shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-700 flex items-center gap-1">
                      <span>🔒 사진 및 예배 동영상 게재 안내</span>
                    </h4>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                      스마랑 한인교회의 사역 사진첩과 최신 예배 동영상 업로드는 **웹서비스 관리자(목회자/사무간사)** 인증 후에만 신규 등록이 허용됩니다.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className="bg-[#2D5A27]/10 hover:bg-[#2D5A27]/20 text-[#2D5A27] font-bold py-2 px-3.5 rounded-xl transition-all whitespace-nowrap text-[11px] shrink-0 cursor-pointer"
                >
                  관리자 로그인하기
                </button>
              </div>
            )}

            {/* Grid of gallery/photos */}
            <h3 className="text-xl font-bold text-gray-800 mb-3 block">교회 추억 사진록</h3>
            <p className="text-xs text-gray-500 mb-5">스마랑 전례 및 사역에서 흘린 땀방울과 성도님들의 다정한 기록들입니다.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
              {galleryItems.map((g) => (
                <div key={g.id} className="border rounded-2xl overflow-hidden bg-white shadow-sm flex flex-col justify-between group relative hover:shadow-md transition-all">
                  <div>
                    {g.imageUrl ? (
                      <div className="h-36 overflow-hidden relative bg-gray-50">
                        <img 
                          src={g.imageUrl} 
                          alt={g.title} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                        />
                      </div>
                    ) : (
                      <div className={`${g.bgClass || 'bg-emerald-950/10 text-emerald-850'} h-36 flex items-center justify-center font-bold text-xs p-4 text-center`}>
                        📷 {g.title}
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                        <span>{g.date}</span>
                        {isAdminAuthenticated && <span className="text-[9px] text-emerald-600 font-bold">관리대상</span>}
                      </div>
                      <h4 className="font-bold text-xs text-gray-800 mb-1">{g.title}</h4>
                      <p className="text-[11px] text-gray-600 font-light leading-relaxed whitespace-pre-line">{g.description}</p>
                    </div>
                  </div>
                  
                  {isAdminAuthenticated && (
                    <div className="flex border-t divide-x text-center bg-gray-50 text-[11px] h-9 items-center shrink-0">
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingGalleryItem(g);
                          // Scroll up to editing view smoothly
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="flex-1 py-1.5 text-gray-700 hover:text-blue-600 font-bold hover:bg-gray-100 transition-all cursor-pointer"
                      >
                        ✏️ 정정
                      </button>
                      <button 
                        type="button"
                        onClick={(e) => handleDeleteGalleryItem(g.id, e)}
                        className="flex-1 py-1.5 text-red-500 hover:text-red-700 font-bold hover:bg-red-50 transition-all cursor-pointer"
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* INTERACTIVE INTERCESSORY PRAYER LIST */}
            <div className="bg-white border rounded-3xl p-6 shadow-sm mb-8">
              <h3 className="text-lg font-bold text-[#2D5A27] mb-2 flex items-center gap-1.5">
                <HeartHandshake className="w-5 h-5 text-[#2D5A27]" />
                스마랑 공동체 중보기도 청원 목록
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                성도님들의 삶의 무거운 짐을 가누며 합심하여 전 능자께 아뢰는 귀한 고백의 성장판입니다.
              </p>

              <div className="space-y-4 mb-6">
                {prayers.map((pr) => (
                  <div key={pr.id} className="p-4 bg-gray-50 rounded-2xl border text-xs">
                    <div className="flex justify-between items-center text-gray-400 font-mono text-[10px] mb-1">
                      <span>청원자: {pr.isPrivate ? '비공개 성도' : pr.name}</span>
                      <span>{pr.createdAt}</span>
                    </div>
                    <p className="text-gray-700 leading-relaxed font-serif">
                      {pr.isPrivate ? '비밀 기도 청탁서입니다. 담임 목사님 이하 중보단만 비공개 기도로 동치합니다.' : pr.content}
                    </p>
                  </div>
                ))}
              </div>

              {/* Submit form for prayer */}
              <div className="border-t pt-5">
                <h4 className="font-bold text-sm text-gray-700 mb-3">기도 나누기 신청</h4>
                {showPrayerSuccess ? (
                  <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 text-center text-xs text-yellow-800 font-medium">
                    기도 제목이 접수되었습니다. 주일 중보 봉사단에서 합심해 기도 올립니다.
                    <button 
                      onClick={() => setShowPrayerSuccess(false)}
                      className="block mx-auto mt-2 text-xs bg-[#2D5A27] text-white px-3 py-1.5 rounded-lg"
                    >
                      목록 새로고침
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handlePrayerSubmit} className="space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div>
                        <input 
                          type="text" 
                          placeholder="성명 (무기는 공안무명)" 
                          value={prayerForm.name}
                          onChange={(e) => setPrayerForm({ ...prayerForm, name: e.target.value })}
                          className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#2D5A27]"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          id="chk-private"
                          checked={prayerForm.isPrivate}
                          onChange={(e) => setPrayerForm({ ...prayerForm, isPrivate: e.target.checked })}
                          className="rounded text-[#2D5A27] focus:ring-[#2D5A27] w-4 h-4"
                        />
                        <label htmlFor="chk-private" className="text-gray-600 font-medium cursor-pointer">
                          비공개 (담임목사에게만 익명 전송)
                        </label>
                      </div>
                    </div>

                    <div>
                      <textarea 
                        required
                        placeholder="합심하여 아뢸 기도의 상세한 내용을 여기에 편안히 적어주세요..." 
                        value={prayerForm.content}
                        onChange={(e) => setPrayerForm({ ...prayerForm, content: e.target.value })}
                        className="w-full border p-3 rounded-xl bg-gray-50 h-20 focus:outline-none focus:ring-1 focus:ring-[#2D5A27]"
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full py-2.5 bg-[#2D5A27] text-white font-bold rounded-xl text-xs shadow hover:bg-emerald-950"
                    >
                      중보기도 청원 올리기
                    </button>
                  </form>
                )}
              </div>
            </div>

          </div>
        )}

        {/* ===================================== */}
        {/* TAB 9: ADMIN PANEL (관리자 CMS 대시보드) */}
        {/* ===================================== */}
        {activeTab === 'admin' && (
          <div className="max-w-5xl mx-auto px-4 py-8">
            <h2 className="text-3xl font-serif font-bold text-gray-800 border-b pb-3 mb-6 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Lock className="w-8 h-8 text-[#2D5A27]" />
                목회자 및 사무처 관리자 시스템
              </span>
              {isAdminAuthenticated && (
                <button 
                  onClick={handleAdminLogout}
                  className="bg-red-100 text-red-600 border border-red-200 text-xs px-3 py-1.5 rounded-xl hover:bg-red-200"
                >
                  로그아웃
                </button>
              )}
            </h2>

            {/* Authentication Lock */}
            {!isAdminAuthenticated ? (
              <div className="max-w-md mx-auto bg-white border p-8 rounded-3xl shadow-sm text-center">
                <Lock className="w-12 h-12 text-[#D69E2E] mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-800">관리자 비밀번호 보호구역</h3>
                <p className="text-xs text-gray-500 mt-2 mb-6 leading-relaxed">
                  이 페이지는 스마랑 한인교회의 사목 및 사무간사가 주보, 최신 설교, 공지사항을 즉시 개정하기 위한 관리 공간입니다.<br/>
                  <span className="text-[#2D5A27] font-bold mt-2 inline-block bg-emerald-50 px-3 py-1 rounded">※ 가이드 비밀번호: semarang1991 또는 1234</span>
                </p>

                <form onSubmit={handleAdminLogin} className="space-y-3">
                  <input 
                    type="password" 
                    required
                    placeholder="비밀번호 입력"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full border p-3 rounded-xl bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#2D5A27] text-center text-sm font-mono"
                  />
                  {adminLoginError && (
                    <div className="text-[12px] text-red-600 font-bold bg-ref/5 mt-2 rounded-xl text-left">
                      {adminLoginError.includes('unauthorized-domain') || adminLoginError.includes('domain') || adminLoginError.includes('도메인') ? (
                        <div className="bg-red-50 border border-red-200 p-4 rounded-2xl text-gray-800 font-normal space-y-3 text-xs">
                          <p className="font-extrabold text-red-600 text-sm flex items-center gap-1">
                            🚨 도메인 승인 필요 (Unauthorized Domain Error)
                          </p>
                          <p className="leading-relaxed">
                            현재 접속하신 외망 주소 <strong className="text-red-700 font-bold underline font-mono select-all bg-white px-1.5 py-0.5 rounded border border-red-150">{window.location.hostname}</strong>가 Firebase Console에 승인된 도메인으로 등록되어 있지 않아 구글 로그인이 차단되었습니다.
                          </p>
                          <div className="bg-white border rounded-xl p-3 space-y-2 text-[11px] text-gray-700 shadow-inner">
                            <p className="font-bold text-gray-900 border-b pb-1">🛠️ 해결 방법 (1분 소요):</p>
                            <ol className="list-decimal pl-4.5 space-y-1.5 leading-normal">
                              <li>
                                <a 
                                  href="https://console.firebase.google.com/project/formidable-bazaar-l8gvj/authentication/settings" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-[#4285F4] hover:underline font-extrabold inline-flex items-center gap-0.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100"
                                >
                                  Firebase Console - 관리자 설정 바로가기 🔗
                                </a>
                              </li>
                              <li>
                                중앙의 <strong>"승인된 도메인" (Authorized domains)</strong> 목록으로 스크롤합니다.
                              </li>
                              <li>
                                <strong>"도메인 추가" (Add domain)</strong> 버튼을 클릭합니다.
                              </li>
                              <li>
                                복사해 둘 현재 주소: <code className="bg-amber-100 text-amber-850 px-1 py-0.5 rounded font-bold font-mono select-all select-none">{window.location.hostname}</code> (또는 <code className="bg-amber-105 text-amber-900 px-1 py-0.5 rounded font-bold font-mono select-all">sage-daifuku-2b3f0e.netlify.app</code>)를 소문자로 정확히 기입하여 등록을 마칩니다.
                              </li>
                            </ol>
                          </div>
                          <p className="text-[10px] text-gray-400 italic font-medium leading-relaxed">
                            💡 Firebase 등록을 완료하신 후, 브라우저 창을 새로고침(F5)하여 다시 Google 계정 로그인을 누르시면 즉시 정상 정상 가동됩니다!
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-red-500 font-bold whitespace-pre-line text-center">{adminLoginError}</p>
                      )}
                    </div>
                  )}
                  
                  <button 
                    type="submit"
                    className="w-full py-2.5 bg-[#2D5A27] hover:bg-emerald-950 text-white font-extrabold rounded-xl text-xs transition-all"
                  >
                    일반 로그인 (조회 모드)
                  </button>
                </form>

                <div className="relative flex py-4 items-center">
                  <div className="flex-grow border-t border-gray-200"></div>
                  <span className="flex-shrink mx-4 text-gray-400 text-xs">또는</span>
                  <div className="flex-grow border-t border-gray-200"></div>
                </div>

                <div className="space-y-2">
                  <button 
                    type="button"
                    onClick={async () => {
                      try {
                        const googleUser = await logInWithGoogle();
                        if (googleUser) {
                          const email = googleUser.email || '';
                          const isGoogleAdmin = isUserAdmin(email) || adminEmails.map(e => e.toLowerCase()).includes(email.toLowerCase());
                          if (isGoogleAdmin) {
                            setIsAdminAuthenticated(true);
                            setIsGoogleAdminUser(true);
                            setAdminLoginError('');
                          } else {
                            await logOutFromFirebase();
                            setAdminLoginError('등록된 관리자 구글 계정(mintjamong99@gmail.com 등)이 아닙니다.');
                          }
                        }
                      } catch (err: any) {
                        console.error("Google Auth error detailed structure:", err);
                        const errCode = err?.code || 'unknown';
                        const errMsg = err?.message || String(err);
                        
                        let customMsg = `구글 로그인 실패 (오류 코드: ${errCode})\n\n`;
                        
                        if (errCode === 'auth/popup-blocked') {
                          customMsg += "🚨 브라우저의 팝업 차단(Block Popups)이 활성화되어 로그인이 차단되었습니다! 주소창 우측에서 팝업 허용을 활성화하시거나 '새창 열기'로 시도해주세요.";
                        } else if (errCode === 'auth/cancelled-popup-request') {
                          customMsg += "ℹ️ 로그인 창이 열렸으나 완료 전 닫혔거나 중단되었습니다. 다시 시도해주세요.";
                        } else if (errCode === 'auth/popup-closed-by-user') {
                          customMsg += "ℹ️ 로그인 팝업창이 사용자에 의해 직접 닫혔습니다.";
                        } else if (errCode === 'auth/operation-not-allowed') {
                          customMsg += "🚨 [설정 오류] Firebase Auth 콘솔 -> 'Sign-in method'에서 'Google' 로그인 제공업체(Provider)가 현재 활성화(Enabled) 상태인지 점검해주세요!";
                        } else if (errCode === 'auth/unauthorized-domain') {
                          customMsg += "🚨 [도메인 승인 오류] Firebase 콘솔 -> Auth -> Settings -> 'Authorized domains'에 현재 개발용 URL 도메인이 승인 대상(Authorize)으로 추가되어 있는지 확인해 주세요.";
                        } else {
                          customMsg += `상세 메시지: ${errMsg}\n\n💡 미리보기 프레임(iFrame) 크로스 도메인 보안 제약일 수 있습니다. 본 화면 우측 상단의 [새창 열기 (Open in new tab)] 단독 탭으로 실행하시면 즉시 100% 한 번에 정상적으로 동작합니다!`;
                        }
                        
                        setAdminLoginError(customMsg);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#4285F4] hover:bg-blue-600 text-white font-extrabold rounded-xl text-xs transition-all shadow-sm cursor-pointer"
                  >
                    <svg className="w-4 h-4 bg-white p-0.5 rounded-full shrink-0" viewBox="0 0 24 24" width="16" height="16">
                      <path fill="#EA4335" d="M12 5.04c1.67 0 3.14.58 4.31 1.7L19.5 3.5C17.48 1.63 14.93.5 12 .5 7.42.5 3.53 3.12 1.63 6.95l3.87 3a6.97 6.97 0 0 1 6.5-4.91z" />
                      <path fill="#4285F4" d="M23.5 12.25c0-.82-.07-1.61-.21-2.38H12v4.51h6.46a5.52 5.52 0 0 1-2.4 3.62l3.73 2.9c2.18-2 3.71-4.96 3.71-8.65z" fillRule="evenodd" clipRule="evenodd" />
                      <path fill="#FBBC05" d="M5.5 14.53a6.94 6.94 0 0 1 0-5.06l-3.87-3A11.96 11.96 0 0 0 .5 12c0 2.02.51 3.93 1.39 5.61l3.61-3.08z" fillRule="evenodd" clipRule="evenodd" />
                      <path fill="#34A853" d="M12 23.5c3.24 0 5.97-1.08 7.96-2.9l-3.73-2.9c-1.1.75-2.52 1.19-4.23 1.19a6.97 6.97 0 0 1-6.5-4.91l-3.87 3A11.93 11.93 0 0 0 12 23.5z" fillRule="evenodd" clipRule="evenodd" />
                    </svg>
                    Google 계정으로 관리자 로그인
                  </button>

                  {/* PRO-TIPS AND DIALOG TROUBLESHOOTING BOX */}
                  <div className="bg-gray-50 border border-gray-150 rounded-2xl p-4 text-left space-y-2 mt-4">
                    <p className="text-[11px] font-bold text-gray-800 flex items-center gap-1">
                      💡 로그인 실패 시 해결 조치 가이드
                    </p>
                    <ul className="text-[10px] text-gray-500 space-y-1.5 list-disc pl-3.5 leading-normal">
                      <li>
                        <strong className="text-[#2D5A27]">가장 확실한 방법 [새창 실행]</strong>: 
                        현재 AI Studio의 <span className="underline">아이프레임(iFrame) 미리보기 내부</span>에서는 브라우저의 크로스-사이트 쿠키 제약으로 소셜 로그인이 가단될 수 있습니다. <strong>우측 최상단의 [주소창 열람 / Open in new tab] 아이콘</strong>을 클릭하여 크고 넓은 전체 화면 탭으로 접속하신 뒤 로그인을 선택하면 즉시 완벽하게 Google Authenticator 처리가 연동됩니다.
                      </li>
                      <li>
                        <strong>브라우저 팝업 허용</strong>: 클릭 시 팝업 창이 열릴 수 있도록 현재 주소 표시줄 근처에 활성화된 <strong>'팝업 차단 아이콘'</strong>을 누르고 항상 허용으로 지정해 주세요.
                      </li>
                      <li>
                        <strong>Firebase Google Provider 활성화</strong>: Firebase auth 콘솔 내의 <strong>'Authentication &gt; Sign-in method'</strong> 메뉴에서 <strong>'Google'</strong> 소셜 로그인이 활성화 상태(Enabled)인지 최종 확인해주세요!
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              // CMS MAIN DASHBOARD
              <div className="space-y-8">

                {/* 1. Admin Emails Manager (Max 5) */}
                <div id="admin_emails_manager" className="bg-white border rounded-3xl p-6 shadow-sm">
                  <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-3 mb-4 gap-2">
                    <div>
                      <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                        👤 시스템 관리자 설정 <span className="text-[#2D5A27] font-mono">({adminEmails.length}/5명)</span>
                      </h3>
                      <p className="text-[11px] text-gray-500 mt-1">
                        데이터 수정/삭제 권한이 부여되는 Google 로그인 계정을 등록·해제합니다. (최대 5명 제한)
                      </p>
                    </div>
                    {!isGoogleAdminUser && (
                      <span className="shrink-0 text-[10px] bg-amber-50 text-[#D69E2E] border border-amber-200 px-2 py-1 rounded-lg font-bold">
                        ⚠️ 일반 로그인 조회 모드 (정정/삭제 불가)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                    {/* Add Admin form */}
                    <form onSubmit={handleAddAdminEmail} className="space-y-3">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">새 관리자 Google 이메일 등록</label>
                        <div className="flex gap-2">
                          <input 
                            type="email" 
                            required
                            disabled={!isGoogleAdminUser || adminEmails.length >= 5}
                            placeholder={adminEmails.length >= 5 ? "최대인원(5명) 가득 참" : "example@gmail.com"}
                            value={newAdminEmail}
                            onChange={(e) => setNewAdminEmail(e.target.value)}
                            className="flex-1 border p-2.5 rounded-xl bg-gray-50 focus:outline-none disabled:opacity-50"
                          />
                          <button 
                            type="submit"
                            disabled={!isGoogleAdminUser || adminEmails.length >= 5}
                            className="bg-[#2D5A27] hover:bg-opacity-90 disabled:bg-gray-300 text-white px-4 py-2.5 rounded-xl font-bold transition-all shrink-0 cursor-pointer text-xs"
                          >
                            등록
                          </button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          ※ 등록 즉시 Firestore Security Rules 실시간 정책 데이터에 반영되어 수정 및 삭제 권한이 위임됩니다.
                        </p>
                      </div>
                    </form>

                    {/* Admin List */}
                    <div>
                      <label className="block text-gray-700 font-bold mb-1">등록된 관리자 목록</label>
                      <div className="border rounded-2xl divide-y bg-gray-50 overflow-hidden max-h-[140px] overflow-y-auto">
                        {adminEmails.map(email => (
                          <div key={email} className="p-2.5 flex justify-between items-center bg-white hover:bg-gray-50">
                            <span className="font-mono text-gray-700 font-medium">{email}</span>
                            {email.toLowerCase() !== 'mintjamong99@gmail.com' ? (
                              <button 
                                type="button"
                                disabled={!isGoogleAdminUser}
                                onClick={() => handleRemoveAdminEmail(email)}
                                className="text-red-500 hover:text-red-700 disabled:opacity-30 p-1 cursor-pointer"
                                title="권한 삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-gray-400 font-bold bg-gray-100 px-1.5 py-0.5 rounded">소유자</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* 2. Sermons Manager */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Upload new Sermon form */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm">
                    <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-4">
                      + 신규 주일/수요 설교 동영상 등록
                    </h3>
                    <form onSubmit={handleAddSermon} className="space-y-3.5 text-xs">
                      <div>
                        <label className="block text-gray-700 font-bold mb-1">설교 제목 *</label>
                        <input 
                          type="text" 
                          required
                          placeholder="예: 말씀 위에 든든히 서가는 믿음의 세대"
                          value={newSermon.title}
                          onChange={(e) => setNewSermon({ ...newSermon, title: e.target.value })}
                          className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-gray-700 font-bold mb-1">강사명</label>
                          <input 
                            type="text" 
                            value={newSermon.preacher}
                            onChange={(e) => setNewSermon({ ...newSermon, preacher: e.target.value })}
                            className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-gray-700 font-bold mb-1">성경 구제 본문</label>
                          <input 
                            type="text" 
                            placeholder="예: 마태복음 20:1-5"
                            value={newSermon.scripture}
                            onChange={(e) => setNewSermon({ ...newSermon, scripture: e.target.value })}
                            className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-gray-700 font-bold mb-1">예배 주간 일자</label>
                          <input 
                            type="date" 
                            value={newSermon.date}
                            onChange={(e) => setNewSermon({ ...newSermon, date: e.target.value })}
                            className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-gray-700 font-bold mb-1">유튜브 동영상 ID *</label>
                          <input 
                            type="text" 
                            required
                            placeholder="유튜브 URL 맨끝의 11자리 영문숫자"
                            value={newSermon.youtubeId}
                            onChange={(e) => setNewSermon({ ...newSermon, youtubeId: e.target.value })}
                            className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none font-mono"
                          />
                        </div>
                      </div>
                      <button 
                        type="submit"
                        className="w-full bg-[#2D5A27] text-white py-2 px-3 rounded-xl font-bold hover:bg-[#1a3818] transition-all"
                      >
                        설교 동영상 실시간 업로드
                      </button>
                    </form>
                  </div>

                  {/* Existing Sermons List with deletion */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm overflow-y-auto max-h-[380px]">
                    <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-3">설교 업로드 목록 ({sermons.length})</h3>
                    <div className="divide-y">
                      {sermons.map(s => (
                        <div key={s.id} className="py-2.5 flex justify-between items-center text-xs gap-2">
                          <div>
                            <p className="font-bold text-gray-800">{s.title}</p>
                            <span className="text-[10px] text-gray-400 font-mono">{s.date} | {s.preacher} | {s.scripture}</span>
                          </div>
                          <button 
                            onClick={() => handleDeleteSermon(s.id)}
                            className="text-red-500 hover:text-red-700 p-1 transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* 3. Notices & Announcements CMS Manager */}
                <h3 className="font-serif font-bold text-lg text-gray-800 mt-8 mb-3 border-l-4 border-[#2D5A27] pl-3">
                  📢 교회 소식 및 정기 행정공지 통합 관리
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Announcement Form (Add or Edit) */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm">
                    {editingNotice ? (
                      <div>
                        <div className="flex items-center justify-between border-b pb-2 mb-4 bg-emerald-50 p-2 rounded-xl">
                          <span className="font-bold text-[#2D5A27] text-xs">✏️ 소식 및 행정공지 정정(수정)</span>
                          <button 
                            type="button" 
                            onClick={() => setEditingNotice(null)}
                            className="text-gray-400 hover:text-gray-600 text-[11px] font-bold"
                          >
                            취소
                          </button>
                        </div>
                        <form onSubmit={handleSaveNoticeEdit} className="space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">소식 유형</label>
                              <select 
                                value={editingNotice.category}
                                onChange={(e) => setEditingNotice({ ...editingNotice, category: e.target.value as any })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              >
                                <option value="공지">공지사항</option>
                                <option value="소식">일반 소식</option>
                                <option value="주보">주간 주보지</option>
                                <option value="행사">교회 행사</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">사무처 작성자</label>
                              <input 
                                type="text" 
                                required
                                value={editingNotice.author}
                                onChange={(e) => setEditingNotice({ ...editingNotice, author: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">소식 제목 *</label>
                              <input 
                                type="text" 
                                required
                                value={editingNotice.title}
                                onChange={(e) => setEditingNotice({ ...editingNotice, title: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">게시 기준일</label>
                              <input 
                                type="date" 
                                value={editingNotice.date}
                                onChange={(e) => setEditingNotice({ ...editingNotice, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">공지 상세 설명 *</label>
                            <textarea 
                              required
                              value={editingNotice.content}
                              onChange={(e) => setEditingNotice({ ...editingNotice, content: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 h-20 focus:outline-none whitespace-pre-line"
                            />
                          </div>

                          <button 
                            type="submit"
                            className="w-full bg-[#2D5A27] text-white py-2.5 px-3 rounded-xl font-bold hover:bg-[#1a3818] transition-all"
                          >
                            공지 사항 정정사항 저장
                          </button>
                        </form>
                      </div>
                    ) : (
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-4">
                          + 교회 소식 및 정기 행정공지 업로드
                        </h3>
                        <form onSubmit={handleAddNotice} className="space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">소식 유형</label>
                              <select 
                                value={newNotice.category}
                                onChange={(e) => setNewNotice({ ...newNotice, category: e.target.value as any })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              >
                                <option value="공지">공지사항</option>
                                <option value="소식">일반 소식</option>
                                <option value="주보">주간 주보지</option>
                                <option value="행사">교회 행사</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">사무처 작성자</label>
                              <input 
                                type="text" 
                                required
                                value={newNotice.author}
                                onChange={(e) => setNewNotice({ ...newNotice, author: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">소식 제목 *</label>
                              <input 
                                type="text" 
                                required
                                value={newNotice.title}
                                onChange={(e) => setNewNotice({ ...newNotice, title: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                                placeholder="공지 사항 핵심 문구"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">게시 기준일</label>
                              <input 
                                type="date" 
                                value={newNotice.date}
                                onChange={(e) => setNewNotice({ ...newNotice, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">공지 상세 설명 *</label>
                            <textarea 
                              required
                              value={newNotice.content}
                              onChange={(e) => setNewNotice({ ...newNotice, content: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 h-20 focus:outline-none"
                              placeholder="소식의 조율과 전달할 세부 단락을 입력..."
                            />
                          </div>

                          <button 
                            type="submit"
                            className="w-full bg-[#2D5A27] text-white py-2 px-3 rounded-xl font-bold hover:bg-[#1a3818] transition-all"
                          >
                            신규 소식 반영 완료
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {/* Notices List with Edit/Delete */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm overflow-y-auto max-h-[380px]">
                    <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-3">
                      공지/소식 목록 및 정정/삭제 ({notices.length})
                    </h3>
                    <div className="divide-y">
                      {notices.map(nt => (
                        <div key={nt.id} className="py-2.5 flex justify-between items-start text-xs gap-3">
                          <div className="min-w-0 flex-grow">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                                nt.category === '공지' ? 'bg-red-55 text-red-600 font-bold border border-red-100' :
                                nt.category === '주보' ? 'bg-amber-55 text-amber-700 font-bold border border-amber-100' : 
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {nt.category}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono">{nt.date} | 작성: {nt.author}</span>
                            </div>
                            <p className="font-bold text-gray-800 truncate">{nt.title}</p>
                            <p className="text-[11px] text-gray-500 line-clamp-1 font-light mt-0.5">{nt.content}</p>
                          </div>
                          <div className="flex gap-1 shrink-0 mt-2">
                            <button 
                              onClick={() => setEditingNotice(nt)}
                              className="text-gray-600 hover:text-blue-600 p-1.5 bg-gray-50 hover:bg-blue-50 border rounded-lg transition-all"
                              title="정정 수정"
                            >
                              ✏️
                            </button>
                            <button 
                              onClick={() => handleDeleteNotice(nt.id)}
                              className="text-red-500 hover:text-red-700 p-1.5 bg-gray-50 hover:bg-red-50 border rounded-lg transition-all"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* 4. Calendar Events CMS Manager */}
                <h3 className="font-serif font-bold text-lg text-gray-800 mt-8 mb-3 border-l-4 border-[#D69E2E] pl-3">
                  📅 교회 캘린더 정기 및 기념 행사 조율
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Events Form (Add or Edit) */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm">
                    {editingEvent ? (
                      <div>
                        <div className="flex items-center justify-between border-b pb-2 mb-4 bg-amber-50 p-2 rounded-xl">
                          <span className="font-bold text-[#D69E2E] text-xs">✏️ 캘린더 행사 일정 정정(수정)</span>
                          <button 
                            type="button" 
                            onClick={() => setEditingEvent(null)}
                            className="text-gray-400 hover:text-gray-600 text-[11px] font-bold"
                          >
                            취소
                          </button>
                        </div>
                        <form onSubmit={handleSaveEventEdit} className="space-y-3 text-xs">
                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 고찰 명칭 *</label>
                            <input 
                              type="text" 
                              required
                              value={editingEvent.title}
                              onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">기념 행사 일자 *</label>
                              <input 
                                type="date" 
                                required
                                value={editingEvent.date}
                                onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">일정 시간 가이드</label>
                              <input 
                                type="text" 
                                value={editingEvent.time}
                                onChange={(e) => setEditingEvent({ ...editingEvent, time: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 거행 장소</label>
                            <input 
                              type="text" 
                              value={editingEvent.location}
                              onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 설명</label>
                            <input 
                              type="text" 
                              value={editingEvent.desc}
                              onChange={(e) => setEditingEvent({ ...editingEvent, desc: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <button 
                            type="submit"
                            className="w-full bg-[#D69E2E] text-white py-2.5 px-3 rounded-xl font-bold hover:bg-[#b5801c] transition-all"
                          >
                            행사 캘린더 정정내역 저장
                          </button>
                        </form>
                      </div>
                    ) : (
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-4">
                          + 교회 캘린더 행사 일정 추가
                        </h3>
                        <form onSubmit={handleAddEvent} className="space-y-3 text-xs">
                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 고찰 명칭 *</label>
                            <input 
                              type="text" 
                              required
                              placeholder="예: 반둥안 전교인 새벽 야외 단합 기도"
                              value={newEvent.title}
                              onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">기념 행사 일자 *</label>
                              <input 
                                type="date" 
                                required
                                value={newEvent.date}
                                onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">일정 시간 가이드</label>
                              <input 
                                type="text" 
                                placeholder="예: 오전 09:30"
                                value={newEvent.time}
                                onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 거행 장소</label>
                            <input 
                              type="text" 
                              placeholder="예: 본당 1층 교육실 또는 반둥안 리조트"
                              value={newEvent.location}
                              onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">행사 설명</label>
                            <input 
                              type="text" 
                              value={newEvent.desc}
                              onChange={(e) => setNewEvent({ ...newEvent, desc: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                            />
                          </div>

                          <button 
                            type="submit"
                            className="w-full bg-[#D69E2E] text-white py-2 px-3 rounded-xl font-bold hover:bg-[#B7791F] transition-all"
                          >
                            행사 캘린더 등재
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {/* Events List with Edit/Delete */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm overflow-y-auto max-h-[380px]">
                    <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-3">
                      거행 일정 목록 및 정정/삭제 ({events.length})
                    </h3>
                    <div className="divide-y">
                      {events.map(evt => (
                        <div key={evt.id} className="py-2.5 flex justify-between items-start text-xs gap-3">
                          <div className="min-w-0 flex-grow font-sans">
                            <span className="text-[10px] text-gray-400 font-mono block mb-0.5">{evt.date} | {evt.time}</span>
                            <p className="font-bold text-gray-850 truncate">{evt.title}</p>
                            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 rounded px-1 mt-1 inline-block font-medium">📍 {evt.location}</span>
                            {evt.desc && <p className="text-[10px] text-gray-400 mt-1 italic font-light">{evt.desc}</p>}
                          </div>
                          <div className="flex gap-1 shrink-0 mt-2">
                            <button 
                              onClick={() => setEditingEvent(evt)}
                              className="text-gray-600 hover:text-blue-600 p-1.5 bg-gray-50 hover:bg-blue-50 border rounded-lg transition-all"
                              title="정정 수정"
                            >
                              ✏️
                            </button>
                            <button 
                              onClick={() => handleDeleteEvent(evt.id)}
                              className="text-red-500 hover:text-red-700 p-1.5 bg-gray-50 hover:bg-red-50 border rounded-lg transition-all"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* 4. PDF Bulletins Manager */}
                <div className="bg-white border rounded-3xl p-6 shadow-sm mt-8">
                  <div className="border-b pb-2 mb-4">
                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-[#2D5A27]" />
                      매주 종이주보 PDF 보관소 일감 관리 ({bulletins.length})
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                    
                    {/* List & Deletion */}
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      <h4 className="font-semibold text-gray-600 mb-2">현재 업로드 완료된 종이 주보 일지</h4>
                      {bulletins.length === 0 ? (
                        <p className="text-[11px] text-gray-400 py-4 text-center">업로드된 이력이 존재하지 않습니다.</p>
                      ) : (
                        bulletins.map(b => (
                          <div key={b.id} className="flex items-center justify-between p-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-150 transition-colors">
                            <div className="min-w-0 pr-2">
                              <p className="font-bold text-gray-700 truncate text-xs">{b.title}</p>
                              <p className="text-[9.5px] text-gray-400 font-mono">{b.volume} | {b.date} | {b.fileSize || '크기 미집적'}</p>
                            </div>
                            <button
                              onClick={() => handleDeleteBulletin(b.id)}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {/* PDF upload status help */}
                    <div className="bg-[#FAF9F5] border border-gray-150 rounded-2xl p-4 flex flex-col justify-between">
                      <div>
                        <h4 className="font-extrabold text-[#2D5A27] text-xs mb-1">📢 주보 업로드 지침</h4>
                        <div className="text-[11px] text-gray-550 leading-relaxed font-sans space-y-1 mt-1.5">
                          <p>- 실제 스캔한 종이 주보의 PDF 원본을 가급적 1MB 미만 패키지로 변환해 업로드해 주십시오.</p>
                          <p>- 브라우저 로컬 저장소 동기화 한계로 인해 데이터는 사용하시는 브라우저 내에 안전하게 영구 저장됩니다.</p>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-gray-200 flex justify-between items-center text-[10px] text-gray-400">
                        <span>상태: 보관소 전원 가동 중</span>
                        <button 
                          onClick={() => { setActiveTab('news'); }}
                          className="text-[#2D5A27] font-bold hover:underline"
                        >
                          주보 전용 뷰어 가기 &rarr;
                        </button>
                      </div>
                    </div>

                  </div>
                </div>

                {/* 5. Church Memory Photo CMS Manager */}
                <h3 className="font-serif font-bold text-lg text-gray-800 mt-8 mb-3 border-l-4 border-amber-600 pl-3">
                  📸 교회 추억 사진록 사역 정정 및 업로드 관리
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Photo Form (Add or Edit) */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm">
                    {editingGalleryItem ? (
                      <div>
                        <div className="flex items-center justify-between border-b pb-2 mb-4 bg-amber-50 p-2 rounded-xl">
                          <span className="font-bold text-amber-600 text-xs">✏️ 추억 사진 사역 내용 정정</span>
                          <button 
                            type="button" 
                            onClick={() => {
                              setEditingGalleryItem(null);
                              setGalleryFile(null);
                            }}
                            className="text-gray-400 hover:text-gray-600 text-[11px] font-bold"
                          >
                            취소
                          </button>
                        </div>
                        <form onSubmit={handleSaveGalleryItemEdit} className="space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">사진 제목 *</label>
                              <input 
                                type="text" 
                                required
                                value={editingGalleryItem.title}
                                onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, title: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">기록 일자</label>
                              <input 
                                type="date" 
                                value={editingGalleryItem.date}
                                onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none font-mono"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">상세 기록 / 메모 설명 *</label>
                            <textarea 
                              required
                              value={editingGalleryItem.description}
                              onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, description: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 h-20 focus:outline-none whitespace-pre-line"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 items-center">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">인터넷 이미지 주소</label>
                              <input 
                                type="text"
                                placeholder="https://"
                                value={editingGalleryItem.imageUrl || ''}
                                onChange={(e) => setEditingGalleryItem({ ...editingGalleryItem, imageUrl: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none text-[10px] font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">교체 파일 선택</label>
                              <input 
                                type="file"
                                accept="image/*"
                                onChange={handleGalleryFileChange}
                                className="w-full text-[10px]"
                              />
                            </div>
                          </div>

                          {galleryPreview && (
                            <div className="p-2 border border-emerald-100 rounded-xl bg-emerald-50/30 flex items-center gap-3 animate-pulse">
                              <img src={galleryPreview} className="w-12 h-12 object-cover rounded-lg border-2 border-white shadow" />
                              <div className="text-[10px] text-emerald-800 flex-grow">
                                <span className="font-extrabold font-serif block text-[#2D5A27]">교체될 이미지 미리보기</span>
                              </div>
                              <button 
                                type="button"
                                onClick={() => { setGalleryFile(null); setGalleryPreview(null); }}
                                className="text-[9px] text-red-650 font-bold px-2 py-0.5 bg-red-50 hover:bg-red-155 rounded-lg border shadow-sm"
                              >
                                취소
                              </button>
                            </div>
                          )}

                          <button 
                            type="submit"
                            className="w-full bg-[#2D5A27] text-white py-2.5 px-3 rounded-xl font-bold hover:bg-[#1a3818] transition-all"
                          >
                            정정 사항 동기화 완료
                          </button>
                        </form>
                      </div>
                    ) : (
                      <div>
                        <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-4">
                          + 교회 추억 사진 업로드 및 타이틀화
                        </h3>
                        <form onSubmit={handleAddGalleryItem} className="space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">사진 제목 *</label>
                              <input 
                                type="text" 
                                required
                                placeholder="사진 대표 타이틀"
                                value={newGalleryItem.title}
                                onChange={(e) => setNewGalleryItem({ ...newGalleryItem, title: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">행사 날짜</label>
                              <input 
                                type="date" 
                                value={newGalleryItem.date}
                                onChange={(e) => setNewGalleryItem({ ...newGalleryItem, date: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none font-mono"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-gray-700 font-bold mb-1">상세 기록 / 사역 설명 *</label>
                            <textarea 
                              required
                              placeholder="추억에 조율될 성도 간 사역 은혜 나눔 코멘트를 입력해주세요..."
                              value={newGalleryItem.description}
                              onChange={(e) => setNewGalleryItem({ ...newGalleryItem, description: e.target.value })}
                              className="w-full border p-2.5 rounded-xl bg-gray-50 h-20 focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2 items-center">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">인터넷 이미지 주소 (선택)</label>
                              <input 
                                type="text" 
                                placeholder="https://"
                                value={newGalleryItem.imageUrl}
                                onChange={(e) => setNewGalleryItem({ ...newGalleryItem, imageUrl: e.target.value })}
                                className="w-full border p-2.5 rounded-xl bg-gray-50 focus:outline-none text-[10px] font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">사진 파일 직접 선택</label>
                              <input 
                                type="file" 
                                accept="image/*"
                                onChange={handleGalleryFileChange}
                                className="w-full text-[10px]"
                              />
                            </div>
                          </div>

                          {galleryPreview && (
                            <div className="p-2 border border-emerald-100 rounded-xl bg-emerald-50/30 flex items-center gap-3 animate-pulse">
                              <img src={galleryPreview} className="w-12 h-12 object-cover rounded-lg border-2 border-white shadow" />
                              <div className="text-[10px] text-emerald-800 flex-grow">
                                <span className="font-extrabold font-serif block text-[#2D5A27]">신규 업로드 예정 사진 미리보기</span>
                              </div>
                              <button 
                                type="button"
                                onClick={() => { setGalleryFile(null); setGalleryPreview(null); }}
                                className="text-[9px] text-red-650 font-bold px-2 py-0.5 bg-red-50 hover:bg-red-155 rounded-lg border shadow-sm"
                              >
                                취소
                              </button>
                            </div>
                          )}

                          <button 
                            type="submit"
                            className="w-full bg-[#2D5A27] text-white py-2 px-3 rounded-xl font-bold hover:bg-[#1a3818] transition-all"
                          >
                            신령한 사진록 업로드 완료
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  {/* Photos List with Edit/Delete */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm overflow-y-auto max-h-[380px]">
                    <h3 className="font-bold text-gray-800 text-sm border-b pb-2 mb-3">
                      등록 완료된 사진첩 일람 및 조율 ({galleryItems.length})
                    </h3>
                    <div className="divide-y text-xs">
                      {galleryItems.map(gItem => (
                        <div key={gItem.id} className="py-2.5 flex justify-between items-start gap-3">
                          <div className="min-w-0 flex-grow font-sans flex gap-3 items-center">
                            {gItem.imageUrl ? (
                              <img 
                                src={gItem.imageUrl} 
                                alt={gItem.title} 
                                className="w-12 h-12 rounded-lg object-cover bg-gray-50 border shrink-0" 
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-emerald-50 text-emerald-800 text-[10px] flex items-center justify-center font-bold text-center border shrink-0">
                                No Img
                              </div>
                            )}
                            <div className="min-w-0">
                              <span className="text-[10px] text-gray-400 font-mono block">{gItem.date}</span>
                              <p className="font-bold text-gray-850 truncate">{gItem.title}</p>
                              <p className="text-[10px] text-gray-400 truncate font-light mt-0.5">{gItem.description}</p>
                            </div>
                          </div>
                          
                          <div className="flex gap-1 shrink-0 mt-1">
                            <button 
                              onClick={() => setEditingGalleryItem(gItem)}
                              className="text-gray-600 hover:text-blue-600 p-1.5 bg-gray-50 hover:bg-blue-50 border rounded-lg transition-all"
                              title="정정 수정"
                            >
                              ✏️
                            </button>
                            <button 
                              onClick={(e) => handleDeleteGalleryItem(gItem.id, e)}
                              className="text-red-500 hover:text-red-700 p-1.5 bg-gray-50 hover:bg-red-50 border rounded-lg transition-all"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* 5-B. Registrations & Prayers CMS Manager */}
                <h3 className="font-serif font-bold text-lg text-gray-800 mt-8 mb-3 border-l-4 border-emerald-600 pl-3">
                  📋 새가족 등록 및 중보기도 신청 현황 통합 관리
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Panel A: 새가족 신청 명단 목록확인 */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm flex flex-col justify-between min-h-[420px]">
                    <div>
                      <div className="flex items-center justify-between border-b pb-2 mb-4">
                        <h4 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 bg-white">
                          🌱 새가족 등록 신청 명단 ({registrations.length}명)
                        </h4>
                      </div>

                      {editingRegistration ? (
                        <form onSubmit={handleSaveRegistrationEdit} className="space-y-3 text-xs bg-emerald-50/40 p-3.5 border rounded-2xl">
                          <p className="font-bold text-[#2D5A27] text-xs">✏️ 새가족 정보 정정 (수정)</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">성명 *</label>
                              <input 
                                type="text" 
                                required
                                value={editingRegistration.name}
                                onChange={(e) => setEditingRegistration({ ...editingRegistration, name: e.target.value })}
                                className="w-full border p-2 rounded-lg bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">연락처 *</label>
                              <input 
                                type="text" 
                                required
                                value={editingRegistration.phone}
                                onChange={(e) => setEditingRegistration({ ...editingRegistration, phone: e.target.value })}
                                className="w-full border p-2 rounded-lg bg-white"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">이메일</label>
                              <input 
                                type="email" 
                                value={editingRegistration.email}
                                onChange={(e) => setEditingRegistration({ ...editingRegistration, email: e.target.value })}
                                className="w-full border p-2 rounded-lg bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">생년월일</label>
                              <input 
                                type="text" 
                                placeholder="YYYY-MM-DD"
                                value={editingRegistration.birthDate}
                                onChange={(e) => setEditingRegistration({ ...editingRegistration, birthDate: e.target.value })}
                                className="w-full border p-2 rounded-lg bg-white"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-gray-700 font-bold mb-1">거주 주소</label>
                            <input 
                              type="text" 
                              value={editingRegistration.address}
                              onChange={(e) => setEditingRegistration({ ...editingRegistration, address: e.target.value })}
                              className="w-full border p-2 rounded-lg bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-gray-700 font-bold mb-1">건의/비고 설명</label>
                            <textarea 
                              value={editingRegistration.notes}
                              onChange={(e) => setEditingRegistration({ ...editingRegistration, notes: e.target.value })}
                              className="w-full border p-2 rounded-lg bg-white h-16 resize-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">진행 현황</label>
                              <select
                                value={editingRegistration.status}
                                onChange={(e) => setEditingRegistration({ ...editingRegistration, status: e.target.value as any })}
                                className="w-full border p-2 rounded-lg bg-white"
                              >
                                <option value="대기">대기</option>
                                <option value="완료">완료</option>
                              </select>
                            </div>
                            <div className="flex items-end gap-1.5 justify-end">
                              <button 
                                type="button"
                                onClick={() => setEditingRegistration(null)}
                                className="bg-gray-100 border text-gray-650 hover:bg-gray-200 px-3 py-2 rounded-lg font-bold transition-all text-[11px] cursor-pointer"
                              >
                                취소
                              </button>
                              <button 
                                type="submit"
                                className="bg-[#2D5A27] text-white hover:bg-opacity-95 px-3 py-2 rounded-lg font-bold transition-all text-[11px] cursor-pointer"
                              >
                                저장
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                          {registrations.length === 0 ? (
                            <p className="text-[11px] text-gray-400 py-8 text-center animate-pulse">신청 건이 아직 없습니다.</p>
                          ) : (
                            registrations.map(reg => (
                              <div key={reg.id} className="p-3 bg-gray-50 border border-gray-150 rounded-2xl flex flex-col justify-between text-xs hover:shadow-sm transition-all">
                                <div className="flex justify-between items-start gap-2 border-b border-gray-200 pb-1.5 mb-1.5">
                                  <div>
                                    <span className="font-extrabold text-gray-900 text-sm">{reg.name}</span>
                                    <span className="ml-2 text-[10px] text-gray-400 font-mono">{reg.createdAt}</span>
                                  </div>
                                  <button
                                    onClick={() => handleToggleRegStatus(reg.id)}
                                    className={`px-2 py-0.5 rounded-full font-bold text-[9px] hover:scale-105 transition-all text-center ${
                                      reg.status === '완료' 
                                      ? 'bg-emerald-100 text-emerald-800' 
                                      : 'bg-amber-100 mr-2 text-amber-850 border border-amber-200'
                                    }`}
                                    title="클릭하여 현황 변경"
                                  >
                                    {reg.status}
                                  </button>
                                </div>
                                <div className="space-y-1 text-[11px] text-gray-650 font-sans">
                                  <p><span className="font-semibold text-gray-450 mr-1.5 inline-block w-12">연락처</span> {reg.phone}</p>
                                  {reg.email && <p><span className="font-semibold text-gray-450 mr-1.5 inline-block w-12">이메일</span> {reg.email}</p>}
                                  {reg.birthDate && <p><span className="font-semibold text-gray-450 mr-1.5 inline-block w-12">생년월일</span> {reg.birthDate}</p>}
                                  {reg.address && <p><span className="font-semibold text-gray-450 mr-1.5 inline-block w-12">거주주소</span> {reg.address}</p>}
                                  {reg.notes && (
                                    <div className="mt-1.5 p-2 bg-gray-100 rounded-xl text-gray-700 whitespace-pre-line text-[10px] italic leading-relaxed border">
                                      {reg.notes}
                                    </div>
                                  )}
                                </div>
                                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-gray-155">
                                  <button
                                    type="button"
                                    onClick={() => setEditingRegistration(reg)}
                                    className="px-2.5 py-1 text-[10px] bg-white border text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    ✏️ 수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteReg(reg.id)}
                                    className="px-2.5 py-1 text-[10px] bg-white border text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" /> 삭제
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Panel B: 중보기도 신청 명단 */}
                  <div className="bg-white border rounded-3xl p-6 shadow-sm flex flex-col justify-between min-h-[420px]">
                    <div>
                      <div className="flex items-center justify-between border-b pb-2 mb-4">
                        <h4 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 bg-white">
                          🙏 중보기도 청원 목록 ({prayers.length}건)
                        </h4>
                      </div>

                      {editingPrayer ? (
                        <form onSubmit={handleSavePrayerEdit} className="space-y-3 text-xs bg-amber-50/40 p-3.5 border rounded-2xl">
                          <p className="font-bold text-amber-700 text-xs">✏️ 중보기도 내용 정정 (수정)</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">성명 (청원자) *</label>
                              <input 
                                type="text" 
                                required
                                value={editingPrayer.author}
                                onChange={(e) => setEditingPrayer({ ...editingPrayer, author: e.target.value })}
                                className="w-full border p-2 rounded-lg bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-700 font-bold mb-1">공개 상태 설정</label>
                              <div className="flex items-center gap-2 h-9">
                                <input 
                                  type="checkbox" 
                                  id="editPrayerIsPrivate"
                                  checked={editingPrayer.isPrivate}
                                  onChange={(e) => setEditingPrayer({ ...editingPrayer, isPrivate: e.target.checked })}
                                  className="rounded text-[#2D5A27] focus:ring-[#2D5A27]"
                                />
                                <label htmlFor="editPrayerIsPrivate" className="text-gray-700 font-semibold cursor-pointer select-none">
                                  🔒 비공개 처리
                                </label>
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="block text-gray-700 font-bold mb-1">기도 제목 및 청원 내용 *</label>
                            <textarea 
                              required
                              value={editingPrayer.content}
                              onChange={(e) => setEditingPrayer({ ...editingPrayer, content: e.target.value })}
                              className="w-full border p-2 rounded-lg bg-white h-24"
                            />
                          </div>
                          <div className="flex justify-end gap-1.5 pt-1.5">
                            <button 
                              type="button"
                              onClick={() => setEditingPrayer(null)}
                              className="bg-gray-150 border text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg font-bold transition-all text-[11px] cursor-pointer"
                            >
                              취소
                            </button>
                            <button 
                              type="submit"
                              className="bg-[#2D5A27] text-white hover:bg-opacity-95 px-3 py-2 rounded-lg font-bold transition-all text-[11px] cursor-pointer"
                            >
                              저장
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                          {prayers.length === 0 ? (
                            <p className="text-[11px] text-gray-400 py-8 text-center animate-pulse">중보기도 등록 목록이 없습니다.</p>
                          ) : (
                            prayers.map(pr => (
                              <div key={pr.id} className="p-3 bg-gray-50 border border-gray-150 rounded-2xl flex flex-col justify-between text-xs hover:shadow-sm transition-all">
                                <div className="flex justify-between items-start gap-2 border-b border-gray-200 pb-1.5 mb-1.5">
                                  <div>
                                    <span className="font-extrabold text-gray-900 text-sm">{pr.author}</span>
                                    <span className="ml-2 text-[10px] text-gray-400 font-mono">{pr.date || pr.createdAt}</span>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${
                                    pr.isPrivate 
                                    ? 'bg-red-50 text-red-600 border border-red-100' 
                                    : 'bg-[#2D5A27]/15 text-[#2D5A27]'
                                  }`}>
                                    {pr.isPrivate ? '🔒 비공개' : '🔓 전체공개'}
                                  </span>
                                </div>
                                <p className="text-gray-700 whitespace-pre-line text-[11px] leading-relaxed italic my-1 font-sans">
                                  {pr.content}
                                </p>
                                <div className="flex justify-end gap-1.5 mt-3 pt-2 border-t border-gray-155">
                                  <button
                                    type="button"
                                    onClick={() => setEditingPrayer(pr)}
                                    className="px-2.5 py-1 text-[10px] bg-white border text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    ✏️ 수정
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePrayer(pr.id)}
                                    className="px-2.5 py-1 text-[10px] bg-white border text-red-650 hover:bg-red-50 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" /> 삭제
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* 6. Serving Members CMS Manager */}
                <h3 className="font-serif font-bold text-lg text-gray-800 mt-8 mb-3 border-l-4 border-indigo-600 pl-3">
                  👥 교회를 섬기는 분들 사명관리 (내용 정정)
                </h3>
                <div className="bg-white border rounded-3xl p-6 shadow-sm">
                  <p className="text-xs text-gray-500 mb-4 font-sans leading-relaxed">
                    교회 소개 화면 및 홈페이지 곳곳에 기재되는 교역자, 시무 장로, 선교 장로 등 주요 명단을 정정 개정할 수 있습니다.<br/>
                    구분 기호로 가급적 가운뎃점(•) 또는 쉼표를 사용해 깔끔하게 배열해 주십시오. (예: 이선우 • 임종학 • 최석원)
                  </p>
                  <form onSubmit={handleSaveStaff} className="space-y-4 text-xs font-sans">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-gray-700 font-extrabold mb-1.5">담임목사 명단</label>
                        <input 
                          type="text" 
                          required
                          value={headPastor}
                          onChange={(e) => setHeadPastor(e.target.value)}
                          className="w-full border p-2.5 bg-gray-50 text-gray-850 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="담임목사 이름"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-extrabold mb-1.5">교육 전도사 명단</label>
                        <input 
                          type="text" 
                          required
                          value={evangelists}
                          onChange={(e) => setEvangelists(e.target.value)}
                          className="w-full border p-2.5 bg-gray-50 text-gray-850 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="교육 전도사 이름들"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-extrabold mb-1.5">시무 장로 명단</label>
                        <input 
                          type="text" 
                          required
                          value={elders}
                          onChange={(e) => setElders(e.target.value)}
                          className="w-full border p-2.5 bg-gray-50 text-gray-850 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="시무 장로 이름들"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-extrabold mb-1.5">선교 장로 명단</label>
                        <input 
                          type="text" 
                          required
                          value={missionElders}
                          onChange={(e) => setMissionElders(e.target.value)}
                          className="w-full border p-2.5 bg-gray-50 text-gray-850 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                          placeholder="선교 장로 이름들"
                        />
                      </div>
                    </div>

                    <div className="border-t pt-4 mt-2">
                      <label className="block text-gray-700 font-extrabold mb-2">담임목사 사진 업로드 및 관리</label>
                      <div className="flex flex-col sm:flex-row items-center gap-4 bg-gray-50 p-4 rounded-2xl border">
                        <div className="w-16 h-16 rounded-full overflow-hidden border bg-white shrink-0 shadow-sm">
                          <img src={pastorImage} alt="담임목사 미니프로필" className="w-full h-full object-cover object-top" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="font-bold text-gray-750 text-xs">담임목사 사진 파일 선택</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">정방형(1:1) 비율 이미지 업로드를 공고화합니다.</p>
                          <div className="mt-2 flex gap-2">
                            <input 
                              type="file" 
                              id="cms-pastor-file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handlePastorFileSelect(e.target.files[0]);
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => document.getElementById('cms-pastor-file')?.click()}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-[10px]"
                            >
                              사진 찾기 및 업로드
                            </button>
                            {pastorImage !== 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=256&h=256' && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm('사진을 기본 원래 사진으로 되돌릴까요?')) {
                                    setPastorImage('https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=256&h=256');
                                    localStorage.removeItem('sm_pastor_image');
                                  }
                                }}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-[10px]"
                              >
                                기본 사진 복원
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t">
                      <button 
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-700 hover:shadow-md text-white font-extrabold text-xs px-6 py-2.5 rounded-xl transition-all cursor-pointer"
                      >
                        📁 섬기는 분들 일람 정정 반영하기
                      </button>
                    </div>
                  </form>
                </div>

                <div className="bg-gray-100 p-4 rounded-2xl text-xs flex justify-between items-center text-gray-500 font-semibold mt-8">
                  <span>스마랑 한인교회 공식 CMS Ver 1.5</span>
                  <span>데이터 백업처: 브라우저 LocalStorage 동기형</span>
                </div>

              </div>
            )}
          </div>
        )}

      </main>

      {/* FOOTER AREA */}
      <footer className="bg-[#1C3319] text-white/95 border-t border-emerald-950 mt-12 py-10 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          
          <div className="md:col-span-2 space-y-3 text-xs">
            <h4 className="text-base font-serif font-bold text-[#FFF9E5] tracking-wide flex items-center gap-2">
              스마랑 한인교회 (Semarang Korean Church)
            </h4>
            <p className="text-gray-300 leading-relaxed max-w-sm">
              인도네시아 스마랑 지대의 영광의 불씨가 될 한인 공동체를 가꾸어 다음세대에게 복음을 계승시키는 전 세계적 한인 교회입니다.
            </p>
            <div className="flex gap-4 pt-2">
              <a 
                href="https://www.youtube.com/@%EC%8A%A4%EB%A7%88%EB%9E%91%ED%95%9C%EC%9D%B8%EA%B5%90%ED%9A%8C"
                target="_blank"
                rel="noopener noreferrer" 
                className="text-red-400 hover:underline font-bold flex items-center gap-1"
              >
                ● 공식 유튜브 채널
              </a>
            </div>
          </div>

          <div className="text-xs space-y-2">
            <h5 className="font-bold text-gray-300">퀵 뷰 팩터</h5>
            <ul className="space-y-1.5 text-gray-400">
              <li><button onClick={() => setActiveTab('about')} className="hover:text-white">교회 정보 / 연혁</button></li>
              <li><button onClick={() => setActiveTab('word')} className="hover:text-white">설교 말씀 다시보기</button></li>
              <li><button onClick={() => setActiveTab('news')} className="hover:text-white">교회 주보 / 공지 피드</button></li>
            </ul>
          </div>

        </div>
      </footer>

    </div>
  );
}
