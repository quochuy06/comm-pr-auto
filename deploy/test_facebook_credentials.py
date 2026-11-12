import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("credentials", Path(__file__).with_name("update_facebook_credentials.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Credentials(unittest.TestCase):
    def test_only_token_fields_change_and_backend_precedence_is_updated(self):
        original = 'FACEBOOK_PAGE_ACCESS_TOKEN=old\nDATABASE_URL=private\nFACEBOOK_APP_SECRET=preserved\n'
        changes = {'FACEBOOK_PAGE_ACCESS_TOKEN': 'new', 'FACEBOOK_USER_ACCESS_TOKEN': 'user-new'}
        page = m.values(m.merge(original, changes))
        backend = m.values(m.merge(original, changes, existing_only=True))
        self.assertEqual(page['FACEBOOK_USER_ACCESS_TOKEN'], 'user-new')
        self.assertEqual(backend['FACEBOOK_PAGE_ACCESS_TOKEN'], 'new')
        self.assertNotIn('FACEBOOK_USER_ACCESS_TOKEN', backend)
        self.assertEqual(backend['DATABASE_URL'], 'private')
        self.assertEqual(backend['FACEBOOK_APP_SECRET'], 'preserved')

    def test_metadata_empty_and_special_values_preserved_without_expansion(self):
        data = m.merge('FACEBOOK_USER_TOKEN_EXPIRES_AT=old\n', {'FACEBOOK_USER_TOKEN_EXPIRES_AT': '', 'FACEBOOK_PAGE_ACCESS_TOKEN': r'a\1$literal'})
        self.assertEqual(m.values(data)['FACEBOOK_USER_TOKEN_EXPIRES_AT'], '')
        self.assertEqual(m.values(data)['FACEBOOK_PAGE_ACCESS_TOKEN'], r'a\1$literal')

    def test_newline_is_rejected(self):
        with self.assertRaises(RuntimeError):
            m.merge('', {'FACEBOOK_PAGE_ACCESS_TOKEN': 'token\nUNRELATED=changed'})
