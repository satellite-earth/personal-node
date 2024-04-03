import express from 'express';

const router = express.Router();

// Note these routes expect a reference to the
// app object to be accessible at req.app

router.get('/hello', (req, res) => {
	res.send('TODO serve static app');
});

export default router;
