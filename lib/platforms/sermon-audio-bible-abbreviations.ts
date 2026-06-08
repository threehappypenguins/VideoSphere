import {
  SERMON_AUDIO_BIBLE_BOOKS,
  type SermonAudioBibleBook,
} from '@/lib/platforms/sermon-audio-bible-books';

/**
 * OSIS and Paratext abbreviations for each SA bible book.
 * @see https://api.sermonaudio.com/#OSIS_Book_Definitions
 */
const SERMON_AUDIO_BIBLE_BOOK_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  Genesis: ['Gen', 'GEN'],
  Exodus: ['Exod', 'EXO'],
  Leviticus: ['Lev', 'LEV'],
  Numbers: ['Num', 'NUM'],
  Deuteronomy: ['Deut', 'DEU'],
  Joshua: ['Josh', 'JOS'],
  Judges: ['Judg', 'JDG'],
  Ruth: ['Ruth', 'RUT'],
  '1 Samuel': ['1Sam', '1SA'],
  '2 Samuel': ['2Sam', '2SA'],
  '1 Kings': ['1Kgs', '1KI'],
  '2 Kings': ['2Kgs', '2KI'],
  '1 Chronicles': ['1Chr', '1CH'],
  '2 Chronicles': ['2Chr', '2CH'],
  Ezra: ['Ezra', 'EZR'],
  Nehemiah: ['Neh', 'NEH'],
  Esther: ['Esth', 'EST'],
  Job: ['Job', 'JOB'],
  Psalms: ['Ps', 'PSA'],
  Proverbs: ['Prov', 'PRO'],
  Ecclesiastes: ['Eccl', 'ECC'],
  'Song of Solomon': ['Song', 'SNG'],
  Isaiah: ['Isa', 'ISA'],
  Jeremiah: ['Jer', 'JER'],
  Lamentations: ['Lam', 'LAM'],
  Ezekiel: ['Ezek', 'EZK'],
  Daniel: ['Dan', 'DAN'],
  Hosea: ['Hos', 'HOS'],
  Joel: ['Joel', 'JOL'],
  Amos: ['Amos', 'AMO'],
  Obadiah: ['Obad', 'OBA'],
  Jonah: ['Jonah', 'JON'],
  Micah: ['Mic', 'MIC'],
  Nahum: ['Nah', 'NAM'],
  Habakkuk: ['Hab', 'HAB'],
  Zephaniah: ['Zeph', 'ZEP'],
  Haggai: ['Hag', 'HAG'],
  Zechariah: ['Zech', 'ZEC'],
  Malachi: ['Mal', 'MAL'],
  Matthew: ['Matt', 'MAT'],
  Mark: ['Mark', 'MRK'],
  Luke: ['Luke', 'LUK'],
  John: ['John', 'JHN'],
  Acts: ['Acts', 'ACT'],
  Romans: ['Rom', 'ROM'],
  '1 Corinthians': ['1Cor', '1CO'],
  '2 Corinthians': ['2Cor', '2CO'],
  Galatians: ['Gal', 'GAL'],
  Ephesians: ['Eph', 'EPH'],
  Philippians: ['Phil', 'PHP'],
  Colossians: ['Col', 'COL'],
  '1 Thessalonians': ['1Thess', '1TH'],
  '2 Thessalonians': ['2Thess', '2TH'],
  '1 Timothy': ['1Tim', '1TI'],
  '2 Timothy': ['2Tim', '2TI'],
  Titus: ['Titus', 'TIT'],
  Philemon: ['Phlm', 'PHM'],
  Hebrews: ['Heb', 'HEB'],
  James: ['Jas', 'JAS'],
  '1 Peter': ['1Pet', '1PE'],
  '2 Peter': ['2Pet', '2PE'],
  '1 John': ['1John', '1JN'],
  '2 John': ['2John', '2JN'],
  '3 John': ['3John', '3JN'],
  Jude: ['Jude', 'JUD'],
  Revelation: ['Rev', 'REV'],
};

/**
 * Abbreviation entry paired with its bible book, sorted longest-first for prefix matching.
 */
export const SERMON_AUDIO_BIBLE_TYPED_ABBREVIATIONS: readonly {
  abbrev: string;
  book: SermonAudioBibleBook;
}[] = SERMON_AUDIO_BIBLE_BOOKS.flatMap((book) => {
  const abbreviations = SERMON_AUDIO_BIBLE_BOOK_ABBREVIATIONS[book.displayName] ?? [];
  return abbreviations.map((abbrev) => ({ abbrev, book }));
}).sort((a, b) => b.abbrev.length - a.abbrev.length);
